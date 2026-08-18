
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const APP_NAME = 'Juloos Volunteer Management System';
const MAX_UPLOAD_MB = Math.max(2, Number(process.env.MAX_UPLOAD_MB || 10));
const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) console.warn('DATABASE_URL is not set. The app cannot save registrations until PostgreSQL is configured.');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 2 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
    const ok = allowed.includes(file.mimetype);
    cb(ok ? null : new Error('Use JPG, PNG, WEBP or PDF files only.'));
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: false
}));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'CHANGE_ME'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

function env(name, fallback='') { return process.env[name] || fallback; }

function deriveKey(secret) {
  return crypto.scryptSync(String(secret || 'fallback'), 'juloos-aadhaar-v1', 32);
}
function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(process.env.DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'fallback'), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}
function decryptText(ciphertext, iv, tag) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(process.env.DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'fallback'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
function normalizeAadhaar(v) {
  return String(v || '').replace(/\D/g, '');
}
function maskAadhaar(v) {
  const n = normalizeAadhaar(v);
  return n.length === 12 ? `XXXX-XXXX-${n.slice(-4)}` : 'XXXX-XXXX-XXXX';
}
function makeToken(payload) {
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'CHANGE_ME').update(raw).digest('base64url');
  return `${raw}.${sig}`;
}
function readToken(token) {
  try {
    const [raw,sig]=String(token||'').split('.');
    if(!raw||!sig) return null;
    const expected=crypto.createHmac('sha256', process.env.SESSION_SECRET || 'CHANGE_ME').update(raw).digest('base64url');
    if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null;
    const p=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
    if(!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function setAdminCookie(res,email) {
  const token=makeToken({email, role:'SUPER_ADMIN', exp:Date.now()+8*60*60*1000});
  res.cookie('juloos_admin', token, {httpOnly:true, signed:false, sameSite:'lax', secure:process.env.NODE_ENV==='production', maxAge:8*60*60*1000});
}
function currentAdmin(req) { return readToken(req.cookies.juloos_admin); }
function requireAdmin(req,res,next) {
  const admin=currentAdmin(req);
  if(!admin) return res.redirect('/login?next='+encodeURIComponent(req.originalUrl));
  req.admin=admin; next();
}
app.use((req,res,next)=>{
  res.locals.admin=currentAdmin(req);
  res.locals.appName=APP_NAME;
  res.locals.maskAadhaar=maskAadhaar;
  next();
});

async function initDb() {
  if(!DATABASE_URL) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create the current schema when this is a brand-new database.
    await client.query(`
      CREATE TABLE IF NOT EXISTS volunteers (
        id BIGSERIAL PRIMARY KEY,
        registration_number TEXT UNIQUE,
        volunteer_id TEXT UNIQUE,
        full_name TEXT,
        mobile TEXT,
        whatsapp TEXT,
        age INTEGER,
        gender TEXT,
        area TEXT,
        address TEXT,
        emergency_name TEXT,
        emergency_mobile TEXT,
        volunteer_role TEXT,
        live_photo BYTEA,
        live_photo_mime TEXT,
        aadhaar_document BYTEA,
        aadhaar_mime TEXT,
        aadhaar_ciphertext BYTEA,
        aadhaar_iv BYTEA,
        aadhaar_tag BYTEA,
        aadhaar_last4 CHAR(4),
        approval_status TEXT DEFAULT 'SUBMITTED',
        rejection_reason TEXT,
        batch_id BIGINT,
        id_card_status TEXT DEFAULT 'PENDING',
        consent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS batches (
        id BIGSERIAL PRIMARY KEY,
        batch_code TEXT UNIQUE,
        batch_name TEXT,
        leader_name TEXT,
        leader_mobile TEXT,
        capacity INTEGER DEFAULT 100,
        route_area TEXT,
        meeting_point TEXT,
        reporting_time TEXT,
        status TEXT DEFAULT 'OPEN',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        action TEXT,
        volunteer_id BIGINT,
        admin_email TEXT,
        details TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // IMPORTANT: CREATE TABLE IF NOT EXISTS does not migrate an already-existing
    // table. Earlier builds of this application used a different schema. Add every
    // column the current application needs so an existing Render database upgrades
    // safely instead of failing on the first missing column (such as `mobile`).
    const volunteerColumns = {
      registration_number: 'TEXT',
      volunteer_id: 'TEXT',
      full_name: 'TEXT',
      mobile: 'TEXT',
      whatsapp: 'TEXT',
      age: 'INTEGER',
      gender: 'TEXT',
      area: 'TEXT',
      address: 'TEXT',
      emergency_name: 'TEXT',
      emergency_mobile: 'TEXT',
      volunteer_role: 'TEXT',
      live_photo: 'BYTEA',
      live_photo_mime: 'TEXT',
      aadhaar_document: 'BYTEA',
      aadhaar_mime: 'TEXT',
      aadhaar_ciphertext: 'BYTEA',
      aadhaar_iv: 'BYTEA',
      aadhaar_tag: 'BYTEA',
      aadhaar_last4: 'CHAR(4)',
      approval_status: "TEXT DEFAULT 'SUBMITTED'",
      rejection_reason: 'TEXT',
      batch_id: 'BIGINT',
      id_card_status: "TEXT DEFAULT 'PENDING'",
      consent_at: 'TIMESTAMPTZ',
      created_at: 'TIMESTAMPTZ DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ DEFAULT NOW()'
    };
    for (const [column, definition] of Object.entries(volunteerColumns)) {
      await client.query(`ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    }

    const batchColumns = {
      batch_code: 'TEXT', batch_name: 'TEXT', leader_name: 'TEXT', leader_mobile: 'TEXT',
      capacity: 'INTEGER DEFAULT 100', route_area: 'TEXT', meeting_point: 'TEXT',
      reporting_time: 'TEXT', status: "TEXT DEFAULT 'OPEN'", created_at: 'TIMESTAMPTZ DEFAULT NOW()'
    };
    for (const [column, definition] of Object.entries(batchColumns)) {
      await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    }

    const auditColumns = {
      action: 'TEXT', volunteer_id: 'BIGINT', admin_email: 'TEXT', details: 'TEXT', created_at: 'TIMESTAMPTZ DEFAULT NOW()'
    };
    for (const [column, definition] of Object.entries(auditColumns)) {
      await client.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    }

    // Recover common column names used by older builds if they exist.
    const existing = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('volunteers','batches')
    `);
    const cols = new Set(existing.rows.map(r => `${r.table_name}.${r.column_name}`));
    if (cols.has('volunteers.phone') && cols.has('volunteers.mobile')) {
      await client.query(`UPDATE volunteers SET mobile=phone WHERE (mobile IS NULL OR mobile='') AND phone IS NOT NULL`);
    }
    if (cols.has('volunteers.phone_number') && cols.has('volunteers.mobile')) {
      await client.query(`UPDATE volunteers SET mobile=phone_number WHERE (mobile IS NULL OR mobile='') AND phone_number IS NOT NULL`);
    }

    // Indexes are intentionally created after migration so an old table that lacked
    // `mobile` cannot fail during startup.
    await client.query(`CREATE INDEX IF NOT EXISTS volunteers_mobile_idx ON volunteers(mobile)`);
    await client.query(`CREATE INDEX IF NOT EXISTS volunteers_status_idx ON volunteers(approval_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS volunteers_batch_idx ON volunteers(batch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS volunteers_aadhaar_last4_idx ON volunteers(aadhaar_last4)`);

    // Keep defaults available on legacy rows created before this version.
    await client.query(`UPDATE volunteers SET approval_status='SUBMITTED' WHERE approval_status IS NULL`);
    await client.query(`UPDATE volunteers SET id_card_status='PENDING' WHERE id_card_status IS NULL`);
    await client.query(`UPDATE volunteers SET created_at=NOW() WHERE created_at IS NULL`);
    await client.query(`UPDATE volunteers SET updated_at=NOW() WHERE updated_at IS NULL`);

    await client.query('COMMIT');
    console.log('Database initialization/migration completed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
const dbReady = initDb().catch(e=>console.error('Database initialization failed:',e));

async function nextRegistrationNumber(client) {
  const r=await client.query(`SELECT COALESCE(MAX(id),0)+1 AS n FROM volunteers`);
  return `JUL-${String(r.rows[0].n).padStart(6,'0')}`;
}
async function nextVolunteerId(client) {
  const r=await client.query(`SELECT COALESCE(MAX(id),0)+1 AS n FROM volunteers`);
  return `SDI-JUL-26-${String(r.rows[0].n).padStart(6,'0')}`;
}

app.get('/health', async (req,res)=>{
  try { await dbReady; await pool.query('SELECT 1'); res.json({ok:true, service:APP_NAME}); }
  catch(e){ res.status(503).json({ok:false,error:'database_unavailable'}); }
});

app.get('/',(req,res)=>res.render('home',{title:'Home'}));

app.get('/register',(req,res)=>res.render('register',{title:'Volunteer Registration',error:null}));

app.post('/register',
  upload.fields([{name:'photo',maxCount:1},{name:'aadhaar_document',maxCount:1}]),
  async (req,res)=>{
  try {
    await dbReady;
    const f=req.body;
    const aadhaar=normalizeAadhaar(f.aadhaar);
    if(!/^[2-9]\d{11}$/.test(aadhaar)) throw new Error('Enter a valid 12-digit Aadhaar number.');
    if(f.consent!=='1') throw new Error('You must accept the consent before submitting.');

    const photo=req.files?.photo?.[0];
    const aadhaarDoc=req.files?.aadhaar_document?.[0];
    if(!photo) throw new Error('Please upload a profile photo from your phone/gallery or computer.');
    if(!['image/jpeg','image/png','image/webp'].includes(photo.mimetype)) throw new Error('Profile photo must be JPG, PNG or WEBP.');
    if(!aadhaarDoc) throw new Error('Please upload the Aadhaar card image or PDF.');
    if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(aadhaarDoc.mimetype)) throw new Error('Aadhaar card must be JPG, PNG, WEBP or PDF.');

    const name=String(f.full_name||'').trim();
    const address=String(f.address||'').trim();
    const whatsapp=String(f.whatsapp||'').replace(/\D/g,'');
    const emergency=String(f.emergency_mobile||'').replace(/\D/g,'');
    const age=Number(f.age);
    if(!name||!address||!whatsapp||!emergency||!Number.isInteger(age)||age<12||age>80) throw new Error('Please complete all required personal details.');
    if(!/^[6-9]\d{9}$/.test(whatsapp)) throw new Error('Enter a valid 10-digit WhatsApp number.');
    if(!/^[6-9]\d{9}$/.test(emergency)) throw new Error('Enter a valid 10-digit emergency contact number.');

    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE volunteers IN SHARE ROW EXCLUSIVE MODE');
      const dup=await client.query(`SELECT registration_number,aadhaar_ciphertext,aadhaar_iv,aadhaar_tag FROM volunteers WHERE aadhaar_last4=$1 AND aadhaar_ciphertext IS NOT NULL`,[aadhaar.slice(-4)]);
      for(const row of dup.rows){
        try { if(decryptText(row.aadhaar_ciphertext,row.aadhaar_iv,row.aadhaar_tag)===aadhaar) throw new Error('This Aadhaar number has already been registered.'); }
        catch(e){ if(e.message==='This Aadhaar number has already been registered.') throw e; }
      }
      const mobileDup=await client.query(`SELECT registration_number FROM volunteers WHERE mobile=$1 OR whatsapp=$1 LIMIT 1`,[whatsapp]);
      if(mobileDup.rowCount) throw new Error('This WhatsApp number has already been registered.');

      const reg=await nextRegistrationNumber(client);
      const enc=encryptText(aadhaar);
      const result=await client.query(`
        INSERT INTO volunteers (
          registration_number, volunteer_id, full_name, mobile, whatsapp, age, area, address,
          emergency_mobile, volunteer_role, live_photo, live_photo_mime, aadhaar_document, aadhaar_mime,
          aadhaar_ciphertext, aadhaar_iv, aadhaar_tag, aadhaar_last4, approval_status, id_card_status, consent_at
        ) VALUES ($1,NULL,$2,$3,$3,$4,NULL,$5,$6,NULL,$7,$8,$9,$10,$11,$12,$13,$14,'SUBMITTED','PENDING',NOW())
        RETURNING id,registration_number`,[
          reg,name,whatsapp,age,address,emergency,photo.buffer,photo.mimetype,aadhaarDoc.buffer,aadhaarDoc.mimetype,
          enc.ciphertext,enc.iv,enc.tag,aadhaar.slice(-4)
        ]);
      await client.query('COMMIT');
      res.render('submitted',{title:'Registration Submitted',registration:result.rows[0]});
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch(e) {
    console.error('Registration error:',e);
    res.status(400).render('register',{title:'Volunteer Registration',error:e.message||'Registration failed.'});
  }
});

app.get('/status',(req,res)=>res.render('status',{title:'Check Registration',result:null,error:null}));
app.post('/status',async(req,res)=>{
  try{
    await dbReady;
    const q=String(req.body.registration||'').trim();
    const whatsapp=String(req.body.whatsapp||'').replace(/\D/g,'');
    const r=await pool.query(`SELECT registration_number,volunteer_id,full_name,whatsapp,approval_status,rejection_reason,batch_id,id_card_status,created_at FROM volunteers WHERE (registration_number=$1 OR volunteer_id=$1) AND whatsapp=$2 LIMIT 1`,[q,whatsapp]);
    if(!r.rowCount) return res.render('status',{title:'Check Registration',result:null,error:'Registration not found.'});
    let row=r.rows[0];
    let batch=null;
    if(row.batch_id){const b=await pool.query('SELECT batch_code,batch_name,route_area,reporting_time FROM batches WHERE id=$1',[row.batch_id]);batch=b.rows[0]||null;}
    res.render('status',{title:'Check Registration',result:{...row,batch},error:null});
  }catch(e){res.render('status',{title:'Check Registration',result:null,error:'Unable to check status right now.'});}
});

app.get('/login',(req,res)=>res.render('login',{title:'Admin Login',error:null}));
app.post('/login',(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  const password=String(req.body.password||'');
  const goodEmail=env('ADMIN_EMAIL').trim().toLowerCase();
  const goodPass=env('ADMIN_PASSWORD');
  if(!goodEmail||!goodPass||email!==goodEmail||password!==goodPass) return res.status(401).render('login',{title:'Admin Login',error:'Invalid administrator credentials.'});
  setAdminCookie(res,email);
  res.redirect('/admin');
});
app.post('/logout',(req,res)=>{res.clearCookie('juloos_admin');res.redirect('/');});

app.get('/admin',requireAdmin,async(req,res)=>{
  try{
    await dbReady;
    const counts=(await pool.query(`
      SELECT COUNT(*)::int total,
      COUNT(*) FILTER(WHERE approval_status='SUBMITTED')::int submitted,
      COUNT(*) FILTER(WHERE approval_status='APPROVED')::int approved,
      COUNT(*) FILTER(WHERE approval_status='REJECTED')::int rejected
      FROM volunteers`)).rows[0];
    const pending=(await pool.query(`
      SELECT id,registration_number,volunteer_id,full_name,mobile,RIGHT('XXXX-XXXX-'||aadhaar_last4,14) masked_aadhaar,
      approval_status,volunteer_role,created_at,batch_id
      FROM volunteers ORDER BY id DESC LIMIT 50`)).rows;
    const batches=(await pool.query(`SELECT b.*,COUNT(v.id)::int volunteer_count FROM batches b LEFT JOIN volunteers v ON v.batch_id=b.id GROUP BY b.id ORDER BY b.id DESC`)).rows;
    res.render('dashboard',{title:'Admin Dashboard',counts,pending,batches});
  }catch(e){console.error(e);res.status(500).render('error',{title:'Database Error',message:'Database is not ready. Check DATABASE_URL and Render logs.'});}
});

app.get('/admin/volunteers',requireAdmin,async(req,res)=>{
  try{
    await dbReady;
    const search=String(req.query.search||'').trim();
    const status=String(req.query.status||'').trim();
    const values=[]; const where=[];
    if(search){values.push(`%${search}%`);where.push(`(full_name ILIKE $${values.length} OR mobile ILIKE $${values.length} OR registration_number ILIKE $${values.length} OR volunteer_id ILIKE $${values.length})`);}
    if(status){values.push(status);where.push(`approval_status=$${values.length}`);}
    const sql=`SELECT id,registration_number,volunteer_id,full_name,mobile,RIGHT('XXXX-XXXX-'||aadhaar_last4,14) masked_aadhaar,approval_status,volunteer_role,batch_id,created_at,id_card_status FROM volunteers ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY id DESC LIMIT 500`;
    const rows=(await pool.query(sql,values)).rows;
    const batches=(await pool.query('SELECT * FROM batches ORDER BY id')).rows;
    res.render('volunteers',{title:'Volunteer Database',rows,batches,search,status});
  }catch(e){res.status(500).render('error',{title:'Database Error',message:'Unable to load volunteers.'});}
});

app.get('/admin/volunteer/:id',requireAdmin,async(req,res)=>{
  try{
    await dbReady;
    const r=await pool.query(`SELECT id,registration_number,volunteer_id,full_name,mobile,whatsapp,age,gender,area,address,emergency_name,emergency_mobile,volunteer_role,RIGHT('XXXX-XXXX-'||aadhaar_last4,14) masked_aadhaar,approval_status,rejection_reason,batch_id,id_card_status,created_at FROM volunteers WHERE id=$1`,[req.params.id]);
    if(!r.rowCount) return res.status(404).render('error',{title:'Not Found',message:'Volunteer not found.'});
    const v=r.rows[0];
    const batches=(await pool.query('SELECT * FROM batches ORDER BY id')).rows;
    res.render('volunteer',{title:v.full_name,volunteer:v,batches});
  }catch(e){res.status(500).render('error',{title:'Database Error',message:'Unable to load volunteer.'});}
});

app.get('/admin/volunteer/:id/photo',requireAdmin,async(req,res)=>{
  const r=await pool.query('SELECT live_photo,live_photo_mime FROM volunteers WHERE id=$1',[req.params.id]);
  if(!r.rowCount) return res.sendStatus(404); res.set('Cache-Control','private,no-store').type(r.rows[0].live_photo_mime).send(r.rows[0].live_photo);
});
app.get('/admin/volunteer/:id/aadhaar',requireAdmin,async(req,res)=>{
  const r=await pool.query('SELECT aadhaar_document,aadhaar_mime FROM volunteers WHERE id=$1',[req.params.id]);
  if(!r.rowCount||!r.rows[0].aadhaar_document) return res.sendStatus(404);
  res.set('Cache-Control','private,no-store').type(r.rows[0].aadhaar_mime||'application/octet-stream').send(r.rows[0].aadhaar_document);
});

app.get('/admin/volunteer/:id/reveal-aadhaar',requireAdmin,async(req,res)=>{
  const r=await pool.query('SELECT aadhaar_ciphertext,aadhaar_iv,aadhaar_tag FROM volunteers WHERE id=$1',[req.params.id]);
  if(!r.rowCount) return res.sendStatus(404);
  const aadhaar=decryptText(r.rows[0].aadhaar_ciphertext,r.rows[0].aadhaar_iv,r.rows[0].aadhaar_tag);
  await pool.query('INSERT INTO audit_logs(action,volunteer_id,admin_email,details) VALUES($1,$2,$3,$4)',['REVEAL_AADHAAR',req.params.id,req.admin.email,'Authorized administrator revealed full Aadhaar number']);
  res.json({aadhaar});
});

app.post('/admin/volunteer/:id/decision',requireAdmin,async(req,res)=>{
  const decision=String(req.body.decision||'');
  if(!['APPROVED','REJECTED'].includes(decision)) return res.status(400).send('Invalid decision');
  const reason=String(req.body.reason||'').trim();
  if(decision==='REJECTED'&&!reason) return res.status(400).send('A rejection reason is required.');
  let r;
  if(decision==='APPROVED') {
    const vid=await nextVolunteerId(pool);
    r=await pool.query(`UPDATE volunteers SET approval_status='APPROVED', volunteer_id=COALESCE(volunteer_id,$1), rejection_reason=NULL, updated_at=NOW() WHERE id=$2 RETURNING volunteer_id`,[vid,req.params.id]);
  } else {
    r=await pool.query(`UPDATE volunteers SET approval_status='REJECTED', rejection_reason=$1, updated_at=NOW() WHERE id=$2 RETURNING volunteer_id`,[reason,req.params.id]);
  }
  if(!r.rowCount) return res.sendStatus(404);
  await pool.query('INSERT INTO audit_logs(action,volunteer_id,admin_email,details) VALUES($1,$2,$3,$4)',['STATUS_CHANGE',req.params.id,req.admin.email,`${decision}${reason?': '+reason:''}`]);
  res.redirect('/admin/volunteer/'+req.params.id);
});

app.post('/admin/batches',requireAdmin,async(req,res)=>{
  const f=req.body;
  const code=String(f.batch_code||'').trim().toUpperCase();
  if(!code||!f.batch_name) return res.status(400).send('Batch code and name required.');
  await pool.query(`INSERT INTO batches(batch_code,batch_name,leader_name,leader_mobile,capacity,route_area,meeting_point,reporting_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[code,f.batch_name,f.leader_name||null,f.leader_mobile||null,Number(f.capacity)||100,f.route_area||null,f.meeting_point||null,f.reporting_time||null]);
  res.redirect('/admin');
});
app.post('/admin/volunteer/:id/batch',requireAdmin,async(req,res)=>{
  const batchId=Number(req.body.batch_id)||null;
  if(batchId){
    const ok=await pool.query(`SELECT v.id,b.capacity,COUNT(v2.id)::int cnt FROM volunteers v JOIN batches b ON b.id=$1 LEFT JOIN volunteers v2 ON v2.batch_id=b.id WHERE v.id=$2 GROUP BY v.id,b.id`,[batchId,req.params.id]);
    if(!ok.rowCount) return res.status(400).send('Invalid batch.');
    const x=ok.rows[0]; if(x.cnt>=x.capacity) return res.status(400).send('Batch capacity is full.');
    const cur=await pool.query('SELECT approval_status FROM volunteers WHERE id=$1',[req.params.id]);
    if(cur.rows[0]?.approval_status!=='APPROVED') return res.status(400).send('Only approved volunteers can be assigned to a batch.');
  }
  await pool.query('UPDATE volunteers SET batch_id=$1,updated_at=NOW() WHERE id=$2',[batchId,req.params.id]);
  res.redirect('/admin/volunteer/'+req.params.id);
});

app.get('/admin/volunteer/:id/id-card',requireAdmin,async(req,res)=>{
  const r=await pool.query(`SELECT v.*,b.batch_code,b.batch_name,b.route_area,b.reporting_time FROM volunteers v LEFT JOIN batches b ON b.id=v.batch_id WHERE v.id=$1`,[req.params.id]);
  if(!r.rowCount) return res.sendStatus(404);
  const v=r.rows[0];
  if(v.approval_status!=='APPROVED') return res.status(400).send('Only approved volunteers can receive an ID card.');
  await pool.query(`UPDATE volunteers SET id_card_status='GENERATED',updated_at=NOW() WHERE id=$1`,[req.params.id]);
  const QRCode = require('qrcode');
  const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const verifyUrl = `${baseUrl}/verify/${v.volunteer_id}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 220, margin: 1 });
  res.render('idcard',{title:'Volunteer ID Card',v,qrDataUrl});
});


app.get('/volunteer/:volunteerId/id-card',async(req,res)=>{
  try {
    await dbReady;
    const r=await pool.query(`
      SELECT v.*,b.batch_code,b.batch_name,b.route_area,b.reporting_time
      FROM volunteers v
      LEFT JOIN batches b ON b.id=v.batch_id
      WHERE v.volunteer_id=$1
    `,[req.params.volunteerId]);

    if(!r.rowCount) return res.status(404).render('error',{title:'Not Found',message:'Volunteer record not found.'});
    const v=r.rows[0];

    if(v.approval_status!=='APPROVED') {
      return res.status(403).render('error',{
        title:'ID Card Not Available',
        message:v.approval_status==='REJECTED'
          ? 'This registration was rejected. An ID card cannot be issued.'
          : 'This registration is still waiting for administrator approval.'
      });
    }

    await pool.query(
      `UPDATE volunteers SET id_card_status='GENERATED',updated_at=NOW() WHERE id=$1`,
      [v.id]
    );

    const QRCode = require('qrcode');
    const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const verifyUrl = `${baseUrl}/verify/${v.volunteer_id}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl,{width:220,margin:1});

    res.render('idcard',{title:'Volunteer ID Card',v,qrDataUrl});
  } catch(e) {
    console.error('Public ID card error:',e);
    res.status(500).render('error',{title:'ID Card Error',message:'Unable to generate the ID card right now.'});
  }
});

app.get('/volunteer/:volunteerId/photo',async(req,res)=>{
  const r=await pool.query('SELECT live_photo,live_photo_mime,approval_status FROM volunteers WHERE volunteer_id=$1',[req.params.volunteerId]);
  if(!r.rowCount||r.rows[0].approval_status!=='APPROVED'||!r.rows[0].live_photo) return res.sendStatus(404);
  res.set('Cache-Control','private,no-store').type(r.rows[0].live_photo_mime).send(r.rows[0].live_photo);
});

app.get('/verify/:volunteerId',async(req,res)=>{
  const r=await pool.query(`SELECT v.volunteer_id,v.full_name,v.volunteer_role,v.approval_status,v.id_card_status,b.batch_code,b.batch_name,b.route_area FROM volunteers v LEFT JOIN batches b ON b.id=v.batch_id WHERE v.volunteer_id=$1`,[req.params.volunteerId]);
  if(!r.rowCount||r.rows[0].approval_status!=='APPROVED') return res.render('verify',{title:'Volunteer Verification',valid:false,v:null});
  res.render('verify',{title:'Volunteer Verification',valid:true,v:r.rows[0]});
});

app.use((err,req,res,next)=>{
  console.error(err);
  if(err instanceof multer.MulterError) return res.status(400).render('error',{title:'Upload Error',message:err.code==='LIMIT_FILE_SIZE'?`File is too large. Maximum is ${MAX_UPLOAD_MB} MB.`:err.message});
  res.status(500).render('error',{title:'Server Error',message:'Something went wrong. Please try again.'});
});

app.listen(PORT,()=>console.log(`${APP_NAME} listening on ${PORT}`));
