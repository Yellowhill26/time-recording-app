const express=require("express");
const session=require("express-session");
const pgSession=require("connect-pg-simple")(session);
const {Pool}=require("pg");
const bcrypt=require("bcryptjs");
const crypto=require("crypto");
const helmet=require("helmet");
const path=require("path");
const app=express();
const PORT=process.env.PORT||3000;
if(!process.env.DATABASE_URL){console.error("DATABASE_URL is required");process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==="disable"?false:{rejectUnauthorized:false}});
app.set("trust proxy",1);app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:"100kb"}));app.use(express.urlencoded({extended:false}));
app.use(session({store:new pgSession({pool,tableName:"user_sessions",createTableIfMissing:true}),name:"dpawson.sid",secret:process.env.SESSION_SECRET||"CHANGE_ME",resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:28800000}}));
app.use("/styles.css", express.static(path.join(__dirname, "styles.css")));
app.use("/employee.js", express.static(path.join(__dirname, "employee.js")));
app.use("/manager.js", express.static(path.join(__dirname, "manager.js")));
const q=(t,p=[])=>pool.query(t,p);const sha=v=>crypto.createHash("sha256").update(String(v)).digest("hex");const token=()=>crypto.randomBytes(32).toString("hex");const code=()=>String(Math.floor(100000+Math.random()*900000));
const hrsBetween=(a,b)=>Math.max(0,Math.round((new Date(b)-new Date(a))/60000));
const iso=d=>new Date(d).toISOString().slice(0,10);function weekStart(d=new Date()){d=new Date(d);d.setHours(0,0,0,0);let day=d.getDay();d.setDate(d.getDate()+(day===0?-6:1-day));return iso(d)}function addDays(s,n){let d=new Date(s+"T00:00:00");d.setDate(d.getDate()+n);return iso(d)}
async function audit(type,id,action,details={}){await q(`INSERT INTO audit_log(actor_type,actor_id,action,details) VALUES($1,$2,$3,$4)`,[type,id||null,action,JSON.stringify(details)])}
async function init(){await q(`
CREATE TABLE IF NOT EXISTS manager_users(id SERIAL PRIMARY KEY,name VARCHAR(100) NOT NULL,email VARCHAR(190) UNIQUE NOT NULL,password_hash VARCHAR(255) NOT NULL,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS employees(id SERIAL PRIMARY KEY,employee_number VARCHAR(30) UNIQUE NOT NULL,first_name VARCHAR(100) NOT NULL,last_name VARCHAR(100) NOT NULL DEFAULT '',weekly_minutes INTEGER NOT NULL DEFAULT 2400,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS pairing_codes(id SERIAL PRIMARY KEY,employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,code_hash VARCHAR(64) NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS employee_devices(id SERIAL PRIMARY KEY,employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,token_hash VARCHAR(64) UNIQUE NOT NULL,device_name VARCHAR(120),last_seen_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS work_schedule(day_of_week SMALLINT PRIMARY KEY CHECK(day_of_week BETWEEN 1 AND 7),is_working_day BOOLEAN NOT NULL DEFAULT TRUE,normal_start_time TIME,automatic_finish_time TIME,auto_finish_enabled BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS clock_events(id SERIAL PRIMARY KEY,employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,event_type VARCHAR(20) NOT NULL CHECK(event_type IN ('clock_in','clock_out','break_start','break_end')),event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),source VARCHAR(30) NOT NULL DEFAULT 'employee',notes TEXT);
CREATE TABLE IF NOT EXISTS overtime_requests(id SERIAL PRIMARY KEY,employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,work_date DATE NOT NULL,start_time TIME NOT NULL,finish_time TIME NOT NULL,minutes INTEGER NOT NULL,reason TEXT,status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),reviewed_at TIMESTAMPTZ,reviewed_by INTEGER REFERENCES manager_users(id),manager_note TEXT);
CREATE TABLE IF NOT EXISTS leave_records(id SERIAL PRIMARY KEY,employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,leave_date DATE NOT NULL,leave_type VARCHAR(30) NOT NULL DEFAULT 'annual_leave',minutes_credit INTEGER NOT NULL DEFAULT 480,notes TEXT,created_by INTEGER REFERENCES manager_users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(employee_id,leave_date,leave_type));
CREATE TABLE IF NOT EXISTS audit_log(id BIGSERIAL PRIMARY KEY,actor_type VARCHAR(30) NOT NULL,actor_id INTEGER,action VARCHAR(100) NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
await q(`ALTER TABLE work_schedule ADD COLUMN IF NOT EXISTS unpaid_break_minutes INTEGER NOT NULL DEFAULT 30`);
for(const r of [[1,true,"08:00","17:00",true],[2,true,"08:00","17:00",true],[3,true,"08:00","17:00",true],[4,true,"08:00","17:00",true],[5,true,"08:00","14:00",true],[6,false,null,null,false],[7,false,null,null,false]])await q(`INSERT INTO work_schedule(day_of_week,is_working_day,normal_start_time,automatic_finish_time,auto_finish_enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(day_of_week) DO NOTHING`,r);
let c=await q(`SELECT COUNT(*)::int n FROM employees`);if(c.rows[0].n===0)for(let i=1;i<=6;i++)await q(`INSERT INTO employees(employee_number,first_name) VALUES($1,$2)`,[`EMP${String(i).padStart(2,"0")}`,`Employee ${i}`]);
let email=(process.env.ADMIN_EMAIL||"").trim().toLowerCase(),pass=process.env.ADMIN_PASSWORD||"";if(email&&pass){let e=await q(`SELECT id FROM manager_users WHERE email=$1`,[email]);if(!e.rows.length)await q(`INSERT INTO manager_users(name,email,password_hash) VALUES($1,$2,$3)`,[process.env.ADMIN_NAME||"Manager",email,await bcrypt.hash(pass,12)])}}
async function emp(req){let t=req.get("x-device-token")||req.body?.deviceToken;if(!t)return null;let r=await q(`SELECT e.*,d.id device_id FROM employee_devices d JOIN employees e ON e.id=d.employee_id WHERE d.token_hash=$1 AND d.revoked_at IS NULL AND e.is_active=TRUE`,[sha(t)]);if(!r.rows.length)return null;await q(`UPDATE employee_devices SET last_seen_at=NOW() WHERE id=$1`,[r.rows[0].device_id]);return r.rows[0]}
function manager(req,res,next){if(!req.session.managerId)return res.status(401).json({error:"Manager login required"});next()}
async function state(id){let r=await q(`SELECT event_type FROM clock_events WHERE employee_id=$1 ORDER BY event_time DESC LIMIT 1`,[id]);if(!r.rows.length)return"off";return ["clock_in","break_end"].includes(r.rows[0].event_type)?"working":r.rows[0].event_type==="break_start"?"break":"off"}
function worked(events,schedule=[]){
  const days={};
  const hasSchedule=Array.isArray(schedule)&&schedule.length>0;

  const scheduleByDay={};
  for(const r of schedule){
    scheduleByDay[Number(r.day_of_week)]=r;
  }

  const dayKey=d=>{
    const parts=new Intl.DateTimeFormat("en-GB",{
      timeZone:"Europe/London",
      year:"numeric",
      month:"2-digit",
      day:"2-digit"
    }).formatToParts(d);

    const get=t=>parts.find(p=>p.type===t).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  };

  const dayOfWeek=key=>{
    const [year,month,day]=key.split("-").map(Number);
    const dow=new Date(Date.UTC(year,month-1,day,12)).getUTCDay();
    return dow===0?7:dow;
  };

  for(const e of events){
    const t=new Date(e.event_time);
    const key=dayKey(t);

    if(!days[key]){
      days[key]={
        total:0,
        start:null,
        breakStart:null,
        breakMinutes:0,
        worked:false,
        dayOfWeek:dayOfWeek(key)
      };
    }

    const d=days[key];

    if(e.event_type==="clock_in"){
      d.start=t;
      d.worked=true;
    }else if(e.event_type==="break_start"&&d.start&&!d.breakStart){
      d.breakStart=t;
    }else if(e.event_type==="break_end"&&d.breakStart){
      d.breakMinutes+=Math.max(0,Math.round((t-d.breakStart)/60000));
      d.breakStart=null;
    }else if(e.event_type==="clock_out"&&d.start){
      d.total+=Math.max(0,Math.round((t-d.start)/60000));
      d.start=null;
      d.breakStart=null;
    }
  }

  let total=0;

  for(const d of Object.values(days)){
    if(d.start){
      d.total+=Math.max(0,Math.round((new Date()-d.start)/60000));
    }

    const rule=scheduleByDay[d.dayOfWeek];

    const unpaidBreak=hasSchedule
      ? (rule&&rule.is_working_day
          ? Math.max(0,Number(rule.unpaid_break_minutes??30))
          : 0)
      : 30;

    if(d.worked && d.total>=360 && unpaidBreak>0){
      d.total-=Math.max(unpaidBreak,d.breakMinutes);
    }else if(d.breakMinutes>0){
      d.total-=d.breakMinutes;
    }

    total+=Math.max(0,d.total);
  }

  return Math.max(0,total);
}
async function autoOut(){let d=new Date(),dow=d.getDay()||7,s=await q(`SELECT * FROM work_schedule WHERE day_of_week=$1`,[dow]);if(!s.rows.length||!s.rows[0].auto_finish_enabled||!s.rows[0].automatic_finish_time)return;let [h,m]=String(s.rows[0].automatic_finish_time).split(":").map(Number),cut=new Date(d);cut.setHours(h,m,0,0);if(d<cut)return;let a=await q(`SELECT e.id FROM employees e WHERE e.is_active=TRUE AND (SELECT event_type FROM clock_events c WHERE c.employee_id=e.id ORDER BY event_time DESC LIMIT 1) IN ('clock_in','break_end')`);for(const e of a.rows){let x=await q(`SELECT 1 FROM clock_events WHERE employee_id=$1 AND event_type='clock_out' AND event_time::date=CURRENT_DATE AND source='automatic' LIMIT 1`,[e.id]);if(!x.rows.length){await q(`INSERT INTO clock_events(employee_id,event_type,event_time,source,notes) VALUES($1,'clock_out',$2,'automatic','Automatic finish time')`,[e.id,cut]);await audit("system",null,"automatic_clock_out",{employeeId:e.id})}}}
setInterval(()=>autoOut().catch(console.error),60000);
app.get('/api/health',async(req,res)=>{await q('SELECT 1');res.json({ok:true})});
app.post('/api/employee/pair',async(req,res)=>{let c=String(req.body.code||'').trim();if(!/^\d{6}$/.test(c))return res.status(400).json({error:'Enter the 6-digit pairing code'});let r=await q(`SELECT p.id,p.employee_id,e.first_name,e.last_name FROM pairing_codes p JOIN employees e ON e.id=p.employee_id WHERE p.code_hash=$1 AND p.used_at IS NULL AND p.expires_at>NOW() AND e.is_active=TRUE ORDER BY p.created_at DESC LIMIT 1`,[sha(c)]);if(!r.rows.length)return res.status(400).json({error:'Pairing code is invalid or expired'});let t=token();await q(`INSERT INTO employee_devices(employee_id,token_hash,device_name,last_seen_at) VALUES($1,$2,$3,NOW())`,[r.rows[0].employee_id,sha(t),String(req.body.deviceName||'Employee phone').slice(0,120)]);await q(`UPDATE pairing_codes SET used_at=NOW() WHERE id=$1`,[r.rows[0].id]);res.json({deviceToken:t,employee:{id:r.rows[0].employee_id,name:`${r.rows[0].first_name} ${r.rows[0].last_name}`.trim()}})});
app.get('/api/employee/me',async(req,res)=>{await autoOut();let e=await emp(req);if(!e)return res.status(401).json({error:'This phone is not paired'});let today=await q(`SELECT event_type,event_time,source FROM clock_events WHERE employee_id=$1 AND event_time::date=CURRENT_DATE ORDER BY event_time`,[e.id]);let p=await q(`SELECT COUNT(*)::int n FROM overtime_requests WHERE employee_id=$1 AND status='pending'`,[e.id]);res.json({employee:{id:e.id,name:`${e.first_name} ${e.last_name}`.trim(),employeeNumber:e.employee_number},state:await state(e.id),today:today.rows,pendingOvertime:p.rows[0].n})});
app.post('/api/employee/event',async(req,res)=>{let e=await emp(req);if(!e)return res.status(401).json({error:'This phone is not paired'});let type=req.body.type,s=await state(e.id),allow={off:['clock_in'],working:['clock_out','break_start'],break:['break_end','clock_out']};if(!allow[s]?.includes(type))return res.status(400).json({error:`Cannot ${String(type).replace('_',' ')} while status is ${s}`});await q(`INSERT INTO clock_events(employee_id,event_type) VALUES($1,$2)`,[e.id,type]);await audit('employee',e.id,type,{});res.json({ok:true,state:await state(e.id)})});
app.post('/api/employee/overtime',async(req,res)=>{let e=await emp(req);if(!e)return res.status(401).json({error:'This phone is not paired'});let {workDate,startTime,finishTime,reason}=req.body;if(!workDate||!startTime||!finishTime)return res.status(400).json({error:'Date, start and finish time are required'});let mins=hrsBetween(`${workDate}T${startTime}:00`,`${workDate}T${finishTime}:00`);if(mins<=0||mins>720)return res.status(400).json({error:'Overtime must be between 1 minute and 12 hours'});let r=await q(`INSERT INTO overtime_requests(employee_id,work_date,start_time,finish_time,minutes,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[e.id,workDate,startTime,finishTime,mins,String(reason||'').slice(0,500)]);await audit('employee',e.id,'overtime_submitted',{requestId:r.rows[0].id});res.json({ok:true})});
app.post('/api/manager/login',async(req,res)=>{let email=String(req.body.email||'').trim().toLowerCase(),r=await q(`SELECT * FROM manager_users WHERE email=$1 AND is_active=TRUE`,[email]);if(!r.rows.length||!(await bcrypt.compare(String(req.body.password||''),r.rows[0].password_hash)))return res.status(401).json({error:'Incorrect email or password'});req.session.managerId=r.rows[0].id;req.session.managerName=r.rows[0].name;res.json({ok:true,name:r.rows[0].name})});
app.post('/api/manager/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));app.get('/api/manager/session',(req,res)=>req.session.managerId?res.json({id:req.session.managerId,name:req.session.managerName}):res.status(401).json({error:'Not signed in'}));
app.get('/api/manager/employees',manager,async(req,res)=>res.json((await q(`SELECT * FROM employees ORDER BY id`)).rows));
app.get('/api/manager/time-corrections',manager,async(req,res)=>{
  try{
    const employeeId=Number(req.query.employeeId);
    const date=String(req.query.date||'');

    if(!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)){
      return res.status(400).json({error:'Employee and date are required'});
    }

    const r=await q(`
      SELECT id,event_type,event_time,source
      FROM clock_events
      WHERE employee_id=$1
        AND (event_time AT TIME ZONE 'Europe/London')::date=$2::date
      ORDER BY event_time
    `,[employeeId,date]);

    res.json(r.rows);
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Could not load clocking times'});
  }
});
app.patch('/api/manager/time-corrections/:id',manager,async(req,res)=>{
  try{
    const id=Number(req.params.id);
    const eventTime=String(req.body.eventTime||'');

    if(!id || !eventTime || isNaN(new Date(eventTime).getTime())){
      return res.status(400).json({error:'A valid time is required'});
    }

    const old=await q(
      `SELECT id,employee_id,event_type,event_time,source
       FROM clock_events
       WHERE id=$1`,
      [id]
    );

    if(!old.rows.length){
      return res.status(404).json({error:'Clocking record not found'});
    }

    const r=await q(
      `UPDATE clock_events
       SET event_time=$1,source='manager'
       WHERE id=$2
       RETURNING id,employee_id,event_type,event_time,source`,
      [eventTime,id]
    );

    await audit(
      'manager',
      req.session.managerId,
      'clock_event_corrected',
      {
        eventId:id,
        employeeId:old.rows[0].employee_id,
        eventType:old.rows[0].event_type,
        previousTime:old.rows[0].event_time,
        newTime:r.rows[0].event_time
      }
    );

    res.json(r.rows[0]);
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Could not update clocking time'});
  }
});
app.post('/api/manager/time-corrections',manager,async(req,res)=>{
  try{
    const employeeId=Number(req.body.employeeId);
    const eventType=String(req.body.eventType||'');
    const eventTime=String(req.body.eventTime||'');

    const allowed=['clock_in','clock_out','break_start','break_end'];

    if(!employeeId || !allowed.includes(eventType) || !eventTime || isNaN(new Date(eventTime).getTime())){
      return res.status(400).json({error:'Employee, event type and valid time are required'});
    }

    const r=await q(
      `INSERT INTO clock_events(employee_id,event_type,event_time,source)
       VALUES($1,$2,$3,'manager')
       RETURNING id,employee_id,event_type,event_time,source`,
      [employeeId,eventType,eventTime]
    );

    await audit(
      'manager',
      req.session.managerId,
      'clock_event_added',
      {
        eventId:r.rows[0].id,
        employeeId,
        eventType,
        eventTime:r.rows[0].event_time
      }
    );

    res.json(r.rows[0]);
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Could not add clocking time'});
  }
});
app.delete('/api/manager/time-corrections/:id',manager,async(req,res)=>{
  try{
    const id=Number(req.params.id);

    if(!id){
      return res.status(400).json({error:'A valid clocking record is required'});
    }

    const old=await q(
      `SELECT id,employee_id,event_type,event_time,source
       FROM clock_events
       WHERE id=$1`,
      [id]
    );

    if(!old.rows.length){
      return res.status(404).json({error:'Clocking record not found'});
    }

    await q(
      `DELETE FROM clock_events
       WHERE id=$1`,
      [id]
    );

    await audit(
      'manager',
      req.session.managerId,
      'clock_event_deleted',
      {
        eventId:id,
        employeeId:old.rows[0].employee_id,
        eventType:old.rows[0].event_type,
        eventTime:old.rows[0].event_time,
        source:old.rows[0].source
      }
    );

    res.json({ok:true});
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Could not delete clocking time'});
  }
});

app.post('/api/manager/employees',manager,async(req,res)=>{
  try{
    const employeeNumber=String(req.body.employeeNumber||'').trim();
    const firstName=String(req.body.firstName||'').trim();
    const lastName=String(req.body.lastName||'').trim();

    if(!employeeNumber||!firstName){
      return res.status(400).json({error:'Employee number and first name are required'});
    }

    const r=await q(
      `INSERT INTO employees(employee_number,first_name,last_name,weekly_minutes,is_active)
       VALUES($1,$2,$3,2400,TRUE)
       RETURNING *`,
      [employeeNumber,firstName,lastName]
    );

    await audit('manager',req.session.managerId,'employee_created',{employeeId:r.rows[0].id});
    res.json(r.rows[0]);
  }catch(e){
    if(e.code==='23505') return res.status(400).json({error:'That employee number already exists'});
    console.error(e);
    res.status(500).json({error:'Could not add employee'});
  }
});

app.patch('/api/manager/employees/:id',manager,async(req,res)=>{
  try{
    const id=Number(req.params.id);
    const current=(await q('SELECT * FROM employees WHERE id=$1',[id])).rows[0];

    if(!current) return res.status(404).json({error:'Employee not found'});

    const firstName=req.body.firstName!==undefined ? String(req.body.firstName).trim() : current.first_name;
    const lastName=req.body.lastName!==undefined ? String(req.body.lastName).trim() : current.last_name;
    const weeklyMinutes=req.body.weeklyMinutes!==undefined ? Number(req.body.weeklyMinutes) : current.weekly_minutes;
    const isActive=req.body.isActive!==undefined ? Boolean(req.body.isActive) : current.is_active;

    if(!firstName) return res.status(400).json({error:'First name is required'});
    if(!Number.isFinite(weeklyMinutes)||weeklyMinutes<=0) return res.status(400).json({error:'Weekly target is invalid'});

    const r=await q(
      `UPDATE employees
       SET first_name=$1,last_name=$2,weekly_minutes=$3,is_active=$4
       WHERE id=$5
       RETURNING *`,
      [firstName,lastName,Math.round(weeklyMinutes),isActive,id]
    );

    await audit('manager',req.session.managerId,'employee_updated',{employeeId:id});
    res.json(r.rows[0]);
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Could not update employee'});
  }
});
app.post('/api/manager/employees/:id/pairing-code',manager,async(req,res)=>{let id=Number(req.params.id),c=code();await q(`UPDATE pairing_codes SET used_at=NOW() WHERE employee_id=$1 AND used_at IS NULL`,[id]);await q(`INSERT INTO pairing_codes(employee_id,code_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 minutes')`,[id,sha(c)]);res.json({code:c,expiresInMinutes:30})});
app.post('/api/manager/employees/:id/unpair',manager,async(req,res)=>{await q(`UPDATE employee_devices SET revoked_at=NOW() WHERE employee_id=$1 AND revoked_at IS NULL`,[Number(req.params.id)]);res.json({ok:true})});
app.get('/api/manager/dashboard',manager,async(req,res)=>{await autoOut();let es=await q(`SELECT * FROM employees WHERE is_active=TRUE ORDER BY id`),out=[],ws=weekStart(),schedule=(await q(`SELECT * FROM work_schedule ORDER BY day_of_week`)).rows;for(const e of es.rows){let st=await state(e.id),lv=await q(`SELECT 1 FROM leave_records WHERE employee_id=$1 AND leave_date=CURRENT_DATE LIMIT 1`,[e.id]),td=await q(`SELECT event_type,event_time FROM clock_events WHERE employee_id=$1 AND event_time::date=CURRENT_DATE ORDER BY event_time`,[e.id]),wk=await q(`SELECT event_type,event_time FROM clock_events WHERE employee_id=$1 AND event_time::date BETWEEN $2 AND $3 ORDER BY event_time`,[e.id,ws,addDays(ws,6)]);out.push({id:e.id,employeeNumber:e.employee_number,name:`${e.first_name} ${e.last_name}`.trim(),status:lv.rows.length?'annual leave':st,todayMinutes:worked(td.rows,schedule),
weekMinutes:worked(wk.rows,schedule),weeklyTarget:e.weekly_minutes})}let p=await q(`SELECT o.*,e.first_name,e.last_name FROM overtime_requests o JOIN employees e ON e.id=o.employee_id WHERE o.status='pending' ORDER BY o.submitted_at`);res.json({employees:out,pendingOvertime:p.rows})});
app.get('/api/manager/schedule',manager,async(req,res)=>res.json((await q(`SELECT * FROM work_schedule ORDER BY day_of_week`)).rows));
app.put('/api/manager/schedule/:day',manager,async(req,res)=>{
  let b=req.body;

  await q(
    `UPDATE work_schedule
     SET is_working_day=$2,
         normal_start_time=$3,
         automatic_finish_time=$4,
         auto_finish_enabled=$5,
         unpaid_break_minutes=$6,
         updated_at=NOW()
     WHERE day_of_week=$1`,
    [
      Number(req.params.day),
      !!b.isWorkingDay,
      b.normalStartTime||null,
      b.automaticFinishTime||null,
      !!b.autoFinishEnabled,
      Math.max(0,Number(b.unpaidBreakMinutes??30))
    ]
  );

  res.json({ok:true});
});
app.get('/api/manager/overtime',manager,async(req,res)=>res.json((await q(`SELECT o.*,e.first_name,e.last_name FROM overtime_requests o JOIN employees e ON e.id=o.employee_id ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END,o.submitted_at DESC`)).rows));
app.post('/api/manager/overtime/:id/review',manager,async(req,res)=>{if(!['approved','rejected'].includes(req.body.status))return res.status(400).json({error:'Invalid status'});await q(`UPDATE overtime_requests SET status=$2,reviewed_at=NOW(),reviewed_by=$3,manager_note=$4 WHERE id=$1`,[Number(req.params.id),req.body.status,req.session.managerId,String(req.body.note||'').slice(0,500)]);res.json({ok:true})});
app.get('/api/manager/leave',manager,async(req,res)=>res.json((await q(`SELECT l.*,e.first_name,e.last_name FROM leave_records l JOIN employees e ON e.id=l.employee_id WHERE l.leave_date>=CURRENT_DATE-INTERVAL '60 days' ORDER BY l.leave_date DESC`)).rows));
app.post('/api/manager/leave',manager,async(req,res)=>{let b=req.body;await q(`INSERT INTO leave_records(employee_id,leave_date,minutes_credit,notes,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(employee_id,leave_date,leave_type) DO UPDATE SET minutes_credit=EXCLUDED.minutes_credit,notes=EXCLUDED.notes`,[Number(b.employeeId),b.leaveDate,Number(b.minutesCredit||480),String(b.notes||'').slice(0,500),req.session.managerId]);res.json({ok:true})});
app.delete('/api/manager/leave/:id',manager,async(req,res)=>{await q(`DELETE FROM leave_records WHERE id=$1`,[Number(req.params.id)]);res.json({ok:true})});
app.get('/api/manager/weekly-review',manager,async(req,res)=>{
  const start=req.query.weekStart||weekStart();
  const end=addDays(start,6);

  const es=await q(`SELECT * FROM employees WHERE is_active=TRUE ORDER BY id`);
  const rows=[];
  const schedule=(await q(`SELECT * FROM work_schedule ORDER BY day_of_week`)).rows;

  for(const e of es.rows){
    const ev=await q(`
      SELECT event_type,event_time
      FROM clock_events
      WHERE employee_id=$1
        AND (event_time AT TIME ZONE 'Europe/London')::date
            BETWEEN $2::date AND $3::date
      ORDER BY event_time
    `,[e.id,start,end]);

    const daily=await q(`
      SELECT
        (event_time AT TIME ZONE 'Europe/London')::date::text AS work_date,
        MIN(event_time) FILTER (WHERE event_type='clock_in') AS clock_in,
        MAX(event_time) FILTER (WHERE event_type='clock_out') AS clock_out
      FROM clock_events
      WHERE employee_id=$1
        AND (event_time AT TIME ZONE 'Europe/London')::date
            BETWEEN $2::date AND $3::date
      GROUP BY (event_time AT TIME ZONE 'Europe/London')::date
      ORDER BY (event_time AT TIME ZONE 'Europe/London')::date
    `,[e.id,start,end]);

    const a=(await q(`
      SELECT COALESCE(SUM(minutes),0)::int n
      FROM overtime_requests
      WHERE employee_id=$1
        AND status='approved'
        AND work_date BETWEEN $2 AND $3
    `,[e.id,start,end])).rows[0].n;

    const p=(await q(`
      SELECT COALESCE(SUM(minutes),0)::int n
      FROM overtime_requests
      WHERE employee_id=$1
        AND status='pending'
        AND work_date BETWEEN $2 AND $3
    `,[e.id,start,end])).rows[0].n;

    const l=(await q(`
      SELECT COALESCE(SUM(minutes_credit),0)::int n
      FROM leave_records
      WHERE employee_id=$1
        AND leave_date BETWEEN $2 AND $3
    `,[e.id,start,end])).rows[0].n;

    rows.push({
      id:e.id,
      name:`${e.first_name} ${e.last_name}`.trim(),
      regularMinutes:worked(ev.rows,schedule),
      approvedOvertimeMinutes:a,
      pendingOvertimeMinutes:p,
      leaveMinutes:l,
      weeklyTarget:e.weekly_minutes,
      dailyTimes:daily.rows.map(d=>({
        date:d.work_date,
        clockIn:d.clock_in,
        clockOut:d.clock_out
      }))
    });
  }

  res.json({
    weekStart:start,
    weekEnd:end,
    rows
  });
});
app.get("/employee", (req,res)=>res.sendFile(path.join(__dirname,"employee.html")));app.get("/manager", (req,res)=>res.sendFile(path.join(__dirname,"manager.html")));app.get("*", (req,res)=>res.sendFile(path.join(__dirname,"index.html")));
init().then(()=>app.listen(PORT,()=>console.log(`running ${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
