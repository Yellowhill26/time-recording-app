const $=id=>document.getElementById(id);
const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
function hrs(m){return `${Math.floor((m||0)/60)}h ${String((m||0)%60).padStart(2,"0")}m`;}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function api(url,opts={}){opts.headers={...(opts.headers||{}),"Content-Type":"application/json"};const r=await fetch(url,opts);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d;}
async function init(){try{await api("/api/manager/session");showApp();}catch{}}
function showApp(){$("loginCard").style.display="none";$("managerApp").style.display="block";$("logout").style.display="inline-block";loadDashboard();}
$("loginBtn").onclick=async()=>{try{await api("/api/manager/login",{method:"POST",body:JSON.stringify({email:$("email").value,password:$("password").value})});showApp();}catch(e){$("loginMsg").innerHTML=`<div class="message error">${esc(e.message)}</div>`;}};
$("logout").onclick=async()=>{await api("/api/manager/logout",{method:"POST"});location.reload();};
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active");({dashboard:loadDashboard,employees:loadEmployees,schedule:loadSchedule,overtime:loadOvertime,leave:loadLeave,corrections:loadCorrections,weekly:loadWeekly}[b.dataset.tab])();});

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
  const holidayDays=prompt("Annual holiday entitlement (days)",String(e.holiday_entitlement_days??0));if(holidayDays===null)return;
  const holidayEntitlement=Number(holidayDays);
  const hours=Number(weeklyHours);
  if(!firstName.trim()||!Number.isFinite(hours)||hours<=0){alert("Please enter a valid first name and weekly hours.");return;}
  await api(`/api/manager/employees/${id}`,{method:"PATCH",body:JSON.stringify({firstName:firstName.trim(),lastName:lastName.trim(),weeklyMinutes:Math.round(hours*60),holidayEntitlementDays:holidayEntitlement})});
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

async function loadSchedule(){
  const d=await api("/api/manager/schedule");

  $("schedule").innerHTML=`
    <div class="card">
      <h2>Automatic finish times</h2>
      <p class="muted">Each day has its own setting. Unpaid break minutes are deducted automatically from normal working days.</p>

      <table>
        <tr>
          <th>Day</th>
          <th>Working day</th>
          <th>Start</th>
          <th>Automatic finish</th>
          <th>Unpaid break (minutes)</th>
          <th>Auto finish</th>
          <th></th>
        </tr>

        ${d.map(r=>`
          <tr>
            <td>${days[r.day_of_week-1]}</td>
            <td><input type="checkbox" id="work${r.day_of_week}" ${r.is_working_day?"checked":""}></td>
            <td><input type="time" id="start${r.day_of_week}" value="${r.normal_start_time||""}"></td>
            <td><input type="time" id="finish${r.day_of_week}" value="${r.automatic_finish_time||""}"></td>
            <td><input type="number" id="break${r.day_of_week}" min="0" step="5" value="${r.unpaid_break_minutes??30}"></td>
            <td><input type="checkbox" id="auto${r.day_of_week}" ${r.auto_finish_enabled?"checked":""}></td>
            <td><button class="btn small" onclick="saveDay(${r.day_of_week})">Save</button></td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;
}

window.saveDay=async day=>{
  const button=document.querySelector(`button[onclick="saveDay(${day})"]`);
  const originalText=button?button.textContent:"Save";

  if(button){
    button.disabled=true;
    button.textContent="Saving...";
  }

  try{
    await api(`/api/manager/schedule/${day}`,{
      method:"PUT",
      body:JSON.stringify({
        isWorkingDay:$(`work${day}`).checked,
        normalStartTime:$(`start${day}`).value||null,
        automaticFinishTime:$(`finish${day}`).value||null,
        unpaidBreakMinutes:Number($(`break${day}`).value||0),
        autoFinishEnabled:$(`auto${day}`).checked
      })
    });

    if(button){
      button.textContent="Saved ✓";
      setTimeout(()=>{
        button.disabled=false;
        button.textContent=originalText;
      },1200);
    }
  }catch(e){
    if(button){
      button.disabled=false;
      button.textContent=originalText;
    }
    alert(e.message);
  }
};

async function loadOvertime(){const d=await api("/api/manager/overtime");$("overtime").innerHTML=`<div class="card"><h2>Overtime requests</h2><table><tr><th>Employee</th><th>Date/time</th><th>Duration</th><th>Reason</th><th>Status/action</th></tr>${d.map(o=>`<tr><td>${esc(o.first_name+" "+o.last_name)}</td><td>${String(o.work_date).slice(0,10)}<br>${String(o.start_time).slice(0,5)}–${String(o.finish_time).slice(0,5)}</td><td>${hrs(o.minutes)}</td><td>${esc(o.reason||"")}</td><td>${o.status==="pending"?`<button class="btn small success" onclick="reviewOt(${o.id},'approved')">Approve</button> <button class="btn small danger" onclick="reviewOt(${o.id},'rejected')">Reject</button>`:`<span class="pill">${o.status}</span>`}</td></tr>`).join("")}</table></div>`;}
window.reviewOt=async(id,status)=>{await api(`/api/manager/overtime/${id}/review`,{method:"POST",body:JSON.stringify({status})});loadOvertime();};

function leaveHoursForDate(dateString){
  if(!dateString)return 0;

  const d=new Date(dateString+"T12:00:00");
  const jsDay=d.getDay();
  const dayOfWeek=jsDay===0?7:jsDay;

  const schedule=(window.leaveSchedule||[]);
  const rule=schedule.find(r=>Number(r.day_of_week)===dayOfWeek);

  if(!rule || !rule.is_working_day || !rule.normal_start_time || !rule.automatic_finish_time){
    return 0;
  }

  const toMinutes=time=>{
    const parts=String(time).split(":");
    return Number(parts[0])*60+Number(parts[1]);
  };

  const start=toMinutes(rule.normal_start_time);
  const finish=toMinutes(rule.automatic_finish_time);
  const unpaidBreak=Math.max(0,Number(rule.unpaid_break_minutes??30));

  return Math.max(0,(finish-start-unpaidBreak)/60);
}

function updateLeaveHours(){
  const date=$("leaveDate")?.value;
  const hours=$("leaveHours");
  const amount=Number($("leaveAmount")?.value||1);

  if(hours){
    hours.value=leaveHoursForDate(date)*amount;
  }
}
async function loadLeave(){
const [emps,leave,schedule,summary]=await Promise.all([
  api("/api/manager/employees"),
  api("/api/manager/leave"),
  api("/api/manager/schedule"),
  api("/api/manager/leave-summary")
]);

window.leaveSchedule=schedule;
window.leaveRecords=leave;
  $("leave").innerHTML=`
    <div class="card">
      <h2>Add annual leave</h2>

      <div class="grid two">
        <div>
          <label>Employee</label>
          <select id="leaveEmp">
            ${emps.filter(e=>e.is_active).map(e=>`
              <option value="${e.id}">
                ${esc(e.first_name+" "+e.last_name)}
              </option>
            `).join("")}
          </select>
        </div>

        <div>
          <label>Date</label>
          <input type="date" id="leaveDate" onchange="updateLeaveHours()">
        </div>
<div>
  <label>Leave amount</label>
  <select id="leaveAmount" onchange="updateLeaveHours()">
    <option value="1">Full day</option>
    <option value="0.5">Half day</option>
  </select>
</div>
        <div>
          <label>Paid hours credit</label>
          <input type="number" id="leaveHours" min="0" max="24" step="0.5">
        </div>

        <div>
          <label>Note</label>
          <input id="leaveNote">
        </div>
      </div>

      <div class="actions">
        <button class="btn" onclick="addLeave()">Mark as annual leave</button>
      </div>
    </div>
<div class="card">
  <h2>Annual leave balance - ${summary.year}</h2>

  <table>
    <tr>
      <th>Employee</th>
      <th>Entitlement</th>
      <th>Taken</th>
      <th>Remaining</th>
    </tr>

   ${summary.rows.map(r=>`
  <tr>
    <td>
      <button class="btn small secondary" onclick="toggleLeaveHistory(${r.id})">
        ${esc(r.name)}
      </button>
    </td>
    <td>${Number(r.entitlement).toFixed(1)} days</td>
    <td>${Number(r.taken).toFixed(1)} days</td>
    <td><strong>${Number(r.remaining).toFixed(1)} days</strong></td>
  </tr>
  <tr id="leaveHistory${r.id}" style="display:none">
    <td colspan="4">
      <div id="leaveHistoryContent${r.id}" class="muted">Loading...</div>
    </td>
  </tr>
`).join("")}
  </table>
</div>
   $("leaveDate").value=new Date().toISOString().slice(0,10);
  updateLeaveHours();
}
window.toggleLeaveHistory=id=>{
  const row=document.getElementById(`leaveHistory${id}`);
  const content=document.getElementById(`leaveHistoryContent${id}`);

  if(!row || !content)return;

  if(row.style.display!=="none"){
    row.style.display="none";
    return;
  }

  const records=(window.leaveRecords||[]).filter(
    l=>Number(l.employee_id)===Number(id)
  );

  if(!records.length){
    content.innerHTML="No annual leave recorded for this employee.";
  }else{
    content.innerHTML=`
      <table>
        <tr>
          <th>Date</th>
          <th>Leave amount</th>
          <th>Credit</th>
          <th></th>
        </tr>
        ${records.map(l=>`
          <tr>
            <td>${String(l.leave_date).slice(0,10)}</td>
            <td>${Number(l.leave_amount)===0.5 ? "Half day" : "Full day"}</td>
            <td>${hrs(l.minutes_credit)}</td>
            <td>
              <button class="btn small danger" onclick="removeLeave(${l.id})">Remove</button>
            </td>
          </tr>
        `).join("")}
      </table>
    `;
  }

  row.style.display="";
};
window.updateLeaveHours=updateLeaveHours;

window.addLeave=async()=>{
  await api("/api/manager/leave",{
    method:"POST",
    body:JSON.stringify({
      employeeId:$("leaveEmp").value,
      leaveDate:$("leaveDate").value,
      leaveAmount:Number($("leaveAmount").value||1),
      minutesCredit:Math.round(Number($("leaveHours").value)*60),
      notes:$("leaveNote").value
    })
  });

  loadLeave();
};

window.removeLeave=async id=>{
  if(confirm("Remove this annual leave entry?")){
    await api(`/api/manager/leave/${id}`,{method:"DELETE"});
    loadLeave();
  }
};

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
  <tr>
    <td colspan="7">
      <div class="muted" style="padding:8px 0">
        ${
          (r.dailyTimes||[]).length
          ? r.dailyTimes.map(d=>{
              const day=new Date(d.date+"T12:00:00").toLocaleDateString("en-GB",{weekday:"long"});
              const clockIn=d.clockIn
                ? new Date(d.clockIn).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})
                : "—";
              const clockOut=d.clockOut
                ? new Date(d.clockOut).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})
                : "—";

              return `<strong>${day}</strong>: Clock in ${clockIn} | Clock out ${clockOut}`;
            }).join("<br>")
          : "No clocking times recorded this week."
        }
      </div>
    </td>
  </tr>
`).join("")}
      </table>
    </div>`;
}
init();
async function loadCorrections(){
  const panel=document.getElementById("corrections");
  panel.innerHTML=`
    <div class="card">
      <h2>Time corrections</h2>
      <p class="muted">Use this section to add or correct missed clock-ins, clock-outs and break times.</p>
      <div id="correctionsContent">Loading...</div>
    </div>
  `;
}
async function loadCorrections(){
  const panel=document.getElementById("corrections");

  panel.innerHTML=`
    <div class="card">
      <h2>Time corrections</h2>
      <p class="muted">Select an employee and date to view or correct their clocking times.</p>

      <label>Employee</label>
      <select id="correctionEmployee">
        <option value="">Select employee</option>
      </select>

      <label>Date</label>
      <input id="correctionDate" type="date">

      <button class="btn" id="loadCorrectionsBtn">Load times</button>

<hr style="margin:20px 0">

<h3>Add missing time</h3>

<label>Event</label>
<select id="newCorrectionType">
  <option value="clock_in">Clock in</option>
  <option value="clock_out">Clock out</option>
  <option value="break_start">Break start</option>
  <option value="break_end">Break end</option>
</select>

<label>Time</label>
<input id="newCorrectionTime" type="time">

<button class="btn" id="addCorrectionBtn" onclick="addMissingCorrection()">Add missing time</button>

<div id="correctionsContent" style="margin-top:20px"></div>
    </div>
  `;

  const employees=await api("/api/manager/employees");
const activeEmployees=employees.filter(e=>e.is_active);
  const select=document.getElementById("correctionEmployee");

  activeEmployees.forEach(e=>{
    const option=document.createElement("option");
    option.value=e.id;
    option.textContent=(e.first_name+" "+(e.last_name||"")).trim();
    select.appendChild(option);
  });

  document.getElementById("correctionDate").value=
    new Date().toISOString().slice(0,10);

  document.getElementById("loadCorrectionsBtn").onclick=async()=>{
    const employeeId=select.value;
    const date=document.getElementById("correctionDate").value;

    if(!employeeId || !date){
      document.getElementById("correctionsContent").innerHTML=
        '<div class="error">Please select an employee and date.</div>';
      return;
    }

    try{
  const events=await api(`/api/manager/time-corrections?employeeId=${employeeId}&date=${date}`);

  const labels={
    clock_in:"Clock in",
    clock_out:"Clock out",
    break_start:"Break start",
    break_end:"Break end"
  };

  if(!events.length){
    document.getElementById("correctionsContent").innerHTML=
      '<p class="muted">No clocking times recorded for this employee on this date.</p>';
    return;
  }

  document.getElementById("correctionsContent").innerHTML=`
    <h3>Recorded times</h3>
    <table>
     <tr>
  <th>Event</th>
  <th>Time</th>
  <th>Source</th>
  <th>Action</th>
</tr>
${events.map(e=>`
  <tr>
    <td>${labels[e.event_type]||e.event_type}</td>
    <td>${new Date(e.event_time).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</td>
    <td>${e.source||""}</td>
    <td><button class="btn small secondary" onclick="editCorrection(${e.id},'${e.event_time}')">Edit</button> <button class="btn small danger" onclick="deleteCorrection(${e.id})">Delete</button></td>
  </tr>
`).join("")}
    </table>
  `;
}catch(e){
  document.getElementById("correctionsContent").innerHTML=
    `<div class="error">${esc(e.message)}</div>`;
}
  };
}
window.editCorrection=async(id,eventTime)=>{
  const oldDate=new Date(eventTime);

  const currentTime=oldDate.toLocaleTimeString("en-GB",{
    hour:"2-digit",
    minute:"2-digit"
  });

  const newTime=prompt("Enter the correct time (HH:MM)",currentTime);

  if(!newTime)return;

  if(!/^\d{2}:\d{2}$/.test(newTime)){
    alert("Please enter the time as HH:MM, for example 08:00");
    return;
  }

  const selectedDate=document.getElementById("correctionDate").value;
  const localDateTime=new Date(`${selectedDate}T${newTime}`);

  try{
    await api(`/api/manager/time-corrections/${id}`,{
      method:"PATCH",
      body:JSON.stringify({
        eventTime:localDateTime.toISOString()
      })
    });

    document.getElementById("loadCorrectionsBtn").click();
  }catch(e){
    alert(e.message);
  }
};
window.addMissingCorrection=async()=>{
  const employeeId=document.getElementById("correctionEmployee").value;
  const date=document.getElementById("correctionDate").value;
  const eventType=document.getElementById("newCorrectionType").value;
  const time=document.getElementById("newCorrectionTime").value;

  if(!employeeId || !date || !eventType || !time){
    alert("Please select an employee, date, event and time.");
    return;
  }

  const localDateTime=new Date(`${date}T${time}`);

  try{
    await api("/api/manager/time-corrections",{
      method:"POST",
      body:JSON.stringify({
        employeeId:Number(employeeId),
        eventType,
        eventTime:localDateTime.toISOString()
      })
    });

    document.getElementById("newCorrectionTime").value="";
    document.getElementById("loadCorrectionsBtn").click();
  }catch(e){
    alert(e.message);
  }
};
window.deleteCorrection=async(id)=>{
  if(!confirm("Delete this clocking time?"))return;

  try{
    await api(`/api/manager/time-corrections/${id}`,{
      method:"DELETE"
    });

    document.getElementById("loadCorrectionsBtn").click();
  }catch(e){
    alert(e.message);
  }
};
