const $=id=>document.getElementById(id);
const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
function hrs(m){return `${Math.floor((m||0)/60)}h ${String((m||0)%60).padStart(2,"0")}m`;}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function api(url,opts={}){opts.headers={...(opts.headers||{}),"Content-Type":"application/json"};const r=await fetch(url,opts);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d;}
async function init(){try{await api("/api/manager/session");showApp();}catch{}}
function showApp(){$("loginCard").style.display="none";$("managerApp").style.display="block";$("logout").style.display="inline-block";loadDashboard();}
$("loginBtn").onclick=async()=>{try{await api("/api/manager/login",{method:"POST",body:JSON.stringify({email:$("email").value,password:$("password").value})});showApp();}catch(e){$("loginMsg").innerHTML=`<div class="message error">${esc(e.message)}</div>`;}};
$("logout").onclick=async()=>{await api("/api/manager/logout",{method:"POST"});location.reload();};
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active");({dashboard:loadDashboard,employees:loadEmployees,schedule:loadSchedule,overtime:loadOvertime,leave:loadLeave,weekly:loadWeekly}[b.dataset.tab])();});

async function loadDashboard(){const d=await api("/api/manager/dashboard");const working=d.employees.filter(e=>e.status==="working").length;const leave=d.employees.filter(e=>e.status==="annual leave").length;
$("dashboard").innerHTML=`<div class="grid three"><div class="card"><div class="muted">Working now</div><div class="kpi">${working}</div></div><div class="card"><div class="muted">Annual leave today</div><div class="kpi">${leave}</div></div><div class="card"><div class="muted">Overtime awaiting approval</div><div class="kpi">${d.pendingOvertime.length}</div></div></div>
<div class="card"><h2>Team today</h2><table><tr><th>Employee</th><th>Status</th><th>Today</th><th>This week</th></tr>${d.employees.map(e=>`<tr><td>${esc(e.name)}</td><td><span class="pill ${e.status.replaceAll(" ","-")}">${esc(e.status)}</span></td><td>${hrs(e.todayMinutes)}</td><td>${hrs(e.weekMinutes)} / ${hrs(e.weeklyTarget)}</td></tr>`).join("")}</table></div>`;}

function nextEmployeeNumber(rows){
  const nums=rows.map(e=>Number(String(e.employee_number||"").match(/(\d+)$/)?.[1]||0));
  const next=Math.max(0,...nums)+1;
  return `EMP${String(next).padStart(2,"0")}`;
}

async function loadEmployees(){
  const d=await api("/api/manager/employees");
  const active=d.filter(e=>e.is_active);
  const inactive=d.filter(e=>!e.is_active);
  const nextNo=nextEmployeeNumber(d);
  $("employees").innerHTML=`
  <div class="card">
    <h2>Add employee</h2>
    <div class="grid two">
      <div><label>Employee number</label><input id="newEmpNo" value="${esc(nextNo)}"></div>
      <div><label>Weekly target (hours)</label><input id="newEmpHours" type="number" min="1" max="80" step="0.25" value="40"></div>
      <div><label>First name</label><input id="newEmpFirst" placeholder="First name"></div>
      <div><label>Last name</label><input id="newEmpLast" placeholder="Last name"></div>
    </div>
    <div class="actions"><button class="btn" onclick="addEmployee()">Add employee</button></div>
    <div id="employeeMsg"></div>
  </div>
  <div class="card"><h2>Employees & phone pairing</h2>
  <table><tr><th>No.</th><th>Name</th><th>Weekly target</th><th>Actions</th></tr>
  ${active.map(e=>`<tr><td>${esc(e.employee_number)}</td><td>${esc(e.first_name+" "+e.last_name)}</td><td>${hrs(e.weekly_minutes)}</td><td><button class="btn small secondary" onclick="editEmployee(${e.id})">Edit</button> <button class="btn small" onclick="pair(${e.id},'${esc((e.first_name+" "+e.last_name).replaceAll("'",""))}')">Pair phone</button> <button class="btn small secondary" onclick="unpair(${e.id})">Unpair</button> <button class="btn small danger" onclick="setEmployeeActive(${e.id},false)">Deactivate</button></td></tr>`).join("")}
  </table></div>
  ${inactive.length?`<div class="card"><h2>Inactive employees</h2><table><tr><th>No.</th><th>Name</th><th>Action</th></tr>${inactive.map(e=>`<tr><td>${esc(e.employee_number)}</td><td>${esc(e.first_name+" "+e.last_name)}</td><td><button class="btn small success" onclick="setEmployeeActive(${e.id},true)">Reactivate</button></td></tr>`).join("")}</table></div>`:""}`;
}

window.addEmployee=async()=>{
  try{
    const employeeNumber=$("newEmpNo").value.trim();
    const firstName=$("newEmpFirst").value.trim();
    const lastName=$("newEmpLast").value.trim();
    const hours=Number($("newEmpHours").value||40);
    if(!employeeNumber||!firstName){throw new Error("Employee number and first name are required");}
    const created=await api("/api/manager/employees",{method:"POST",body:JSON.stringify({employeeNumber,firstName,lastName})});
    if(hours!==40){await api(`/api/manager/employees/${created.id}`,{method:"PATCH",body:JSON.stringify({weeklyMinutes:Math.round(hours*60)})});}
    await loadEmployees();
  }catch(e){const el=$("employeeMsg");if(el)el.innerHTML=`<div class="message error">${esc(e.message)}</div>`;}
};

window.editEmployee=async id=>{
  const rows=await api("/api/manager/employees");
  const e=rows.find(x=>x.id===id);
  if(!e)return;
  const firstName=prompt("First name",e.first_name);if(firstName===null)return;
  const lastName=prompt("Last name",e.last_name||"");if(lastName===null)return;
  const weeklyHours=prompt("Weekly target hours",String((e.weekly_minutes/60).toFixed(2).replace(/\.00$/,"")));if(weeklyHours===null)return;
  const hours=Number(weeklyHours);
  if(!firstName.trim()||!Number.isFinite(hours)||hours<=0){alert("Please enter a valid first name and weekly hours.");return;}
  await api(`/api/manager/employees/${id}`,{method:"PATCH",body:JSON.stringify({firstName:firstName.trim(),lastName:lastName.trim(),weeklyMinutes:Math.round(hours*60)})});
  await loadEmployees();
  await loadDashboard();
};

window.setEmployeeActive=async(id,isActive)=>{
  const wording=isActive?"reactivate":"deactivate";
  if(!confirm(`Are you sure you want to ${wording} this employee?`))return;
  await api(`/api/manager/employees/${id}`,{method:"PATCH",body:JSON.stringify({isActive})});
  await loadEmployees();
  await loadDashboard();
};

window.pair=async(id,name)=>{const d=await api(`/api/manager/employees/${id}/pairing-code`,{method:"POST"});alert(`Pairing code for ${name}: ${d.code}\n\nValid for ${d.expiresInMinutes} minutes.`);};
window.unpair=async id=>{if(confirm("Unpair all phones for this employee?")){await api(`/api/manager/employees/${id}/unpair`,{method:"POST"});alert("Phone(s) unpaired.");}};

async function loadSchedule(){const d=await api("/api/manager/schedule");$("schedule").innerHTML=`<div class="card"><h2>Automatic finish times</h2><p class="muted">Each day has its own setting. Friday can therefore finish earlier than Monday–Thursday.</p><table><tr><th>Day</th><th>Working day</th><th>Start</th><th>Automatic finish</th><th>Auto finish</th><th></th></tr>${d.map(r=>`<tr><td>${days[r.day_of_week-1]}</td><td><input type="checkbox" id="work${r.day_of_week}" ${r.is_working_day?"checked":""}></td><td><input type="time" id="start${r.day_of_week}" value="${(r.normal_start_time||"").slice(0,5)}"></td><td><input type="time" id="finish${r.day_of_week}" value="${(r.automatic_finish_time||"").slice(0,5)}"></td><td><input type="checkbox" id="auto${r.day_of_week}" ${r.auto_finish_enabled?"checked":""}></td><td><button class="btn small" onclick="saveDay(${r.day_of_week})">Save</button></td></tr>`).join("")}</table></div>`;}
window.saveDay=async day=>{await api(`/api/manager/schedule/${day}`,{method:"PUT",body:JSON.stringify({isWorkingDay:$(`work${day}`).checked,normalStartTime:$(`start${day}`).value||null,automaticFinishTime:$(`finish${day}`).value||null,autoFinishEnabled:$(`auto${day}`).checked})});alert(`${days[day-1]} saved.`);};

async function loadOvertime(){const d=await api("/api/manager/overtime");$("overtime").innerHTML=`<div class="card"><h2>Overtime requests</h2><table><tr><th>Employee</th><th>Date/time</th><th>Duration</th><th>Reason</th><th>Status/action</th></tr>${d.map(o=>`<tr><td>${esc(o.first_name+" "+o.last_name)}</td><td>${String(o.work_date).slice(0,10)}<br>${String(o.start_time).slice(0,5)}–${String(o.finish_time).slice(0,5)}</td><td>${hrs(o.minutes)}</td><td>${esc(o.reason||"")}</td><td>${o.status==="pending"?`<button class="btn small success" onclick="reviewOt(${o.id},'approved')">Approve</button> <button class="btn small danger" onclick="reviewOt(${o.id},'rejected')">Reject</button>`:`<span class="pill">${o.status}</span>`}</td></tr>`).join("")}</table></div>`;}
window.reviewOt=async(id,status)=>{await api(`/api/manager/overtime/${id}/review`,{method:"POST",body:JSON.stringify({status})});loadOvertime();};

async function loadLeave(){const [emps,leave]=await Promise.all([api("/api/manager/employees"),api("/api/manager/leave")]);$("leave").innerHTML=`<div class="card"><h2>Add annual leave</h2><div class="grid two"><div><label>Employee</label><select id="leaveEmp">${emps.filter(e=>e.is_active).map(e=>`<option value="${e.id}">${esc(e.first_name+" "+e.last_name)}</option>`).join("")}</select></div><div><label>Date</label><input type="date" id="leaveDate"></div><div><label>Paid hours credit</label><input type="number" id="leaveHours" value="8" min="0" max="24" step=".25"></div><div><label>Note</label><input id="leaveNote"></div></div><div class="actions"><button class="btn" onclick="addLeave()">Mark as annual leave</button></div></div>
<div class="card"><h2>Recent leave</h2><table><tr><th>Employee</th><th>Date</th><th>Credit</th><th></th></tr>${leave.map(l=>`<tr><td>${esc(l.first_name+" "+l.last_name)}</td><td>${String(l.leave_date).slice(0,10)}</td><td>${hrs(l.minutes_credit)}</td><td><button class="btn small danger" onclick="removeLeave(${l.id})">Remove</button></td></tr>`).join("")}</table></div>`;$("leaveDate").value=new Date().toISOString().slice(0,10);}
window.addLeave=async()=>{await api("/api/manager/leave",{method:"POST",body:JSON.stringify({employeeId:$("leaveEmp").value,leaveDate:$("leaveDate").value,minutesCredit:Math.round(Number($("leaveHours").value)*60),notes:$("leaveNote").value})});loadLeave();};
window.removeLeave=async id=>{if(confirm("Remove this annual leave entry?")){await api(`/api/manager/leave/${id}`,{method:"DELETE"});loadLeave();}};

async function loadWeekly(){
  const d=await api("/api/manager/weekly-review");

  $("weekly").innerHTML=`
    <div class="card">
      <div class="actions" style="justify-content:space-between">
        <div>
          <h2 style="margin:0">Weekly review</h2>
          <div class="muted">${d.weekStart} to ${d.weekEnd}</div>
        </div>
        <a class="btn secondary" href="/api/manager/weekly-review.csv?weekStart=${d.weekStart}">Download CSV</a>
      </div>

      <table>
        <tr>
          <th>Employee</th>
          <th>Regular</th>
          <th>Approved OT</th>
          <th>Pending OT</th>
          <th>Annual leave</th>
          <th>Total hours</th>
          <th>Target</th>
        </tr>

        ${d.rows.map(r=>`
          <tr>
            <td>${esc(r.name)}</td>
            <td>${hrs(r.regularMinutes)}</td>
            <td>${hrs(r.approvedOvertimeMinutes)}</td>
            <td>${hrs(r.pendingOvertimeMinutes)}</td>
            <td>${hrs(r.leaveMinutes)}</td>
            <td><strong>${hrs(r.regularMinutes+r.approvedOvertimeMinutes+r.leaveMinutes)}</strong></td>
            <td>${hrs(r.weeklyTarget)}</td>
          </tr>
        `).join("")}
      </table>
    </div>`;
}
init();
