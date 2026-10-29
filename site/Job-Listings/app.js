'use strict';
const defaultColumns=['job_url','job_title','company_name','ats_provider','job_category','remote_policy','job_experience_level','is_fulltime','salary','job_summary','job_responsibilities','experience_required','full_job_post','city','country','date_posted','date_added_to_dataset','job_id'];
const columnLabels={company_name:'company',ats_provider:'ats'};
const columnOrderStorageKey='job-listings-column-order-v1';
const $=id=>document.getElementById(id);
let rows=[],filtered=[],columns=loadColumnOrder(),draggedColumn=null;
let companyFilter,atsFilter,remoteFilter,experienceFilter,resettingFilters=false;

function loadColumnOrder(){
 try{
  const saved=JSON.parse(localStorage.getItem(columnOrderStorageKey));
  if(Array.isArray(saved)&&new Set(saved).size===saved.length){
   if(saved.length===defaultColumns.length&&saved.every(key=>defaultColumns.includes(key)))return saved;
   const previousColumns=defaultColumns.filter(key=>key!=='date_added_to_dataset');
   if(saved.length===previousColumns.length&&saved.every(key=>previousColumns.includes(key)))return [...saved,'date_added_to_dataset'];
  }
 }catch{/* Keep column controls usable when storage is unavailable. */}
 return [...defaultColumns];
}
function saveColumnOrder(){try{localStorage.setItem(columnOrderStorageKey,JSON.stringify(columns));}catch{/* Preserve this visit's order without storage. */}}
function moveColumn(from,to){
 if(!from||!to||from===to)return;
 const fromIndex=columns.indexOf(from),toIndex=columns.indexOf(to);
 if(fromIndex<0||toIndex<0)return;
 columns.splice(fromIndex,1);columns.splice(toIndex,0,from);saveColumnOrder();render();
}
function renderHeader(){
 const makeHeader=interactive=>{
  const header=document.createElement('tr');
  for(const col of columns){
   const th=document.createElement('th');th.scope='col';th.dataset.column=col;th.textContent=columnLabels[col]||col;if(col==='job_experience_level')th.classList.add('experience-level');if(col==='date_added_to_dataset')th.classList.add('date-added-to-dataset');
   if(interactive){
    th.draggable=true;th.title='Drag to change displayed column order';
    th.addEventListener('dragstart',event=>{draggedColumn=col;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',col);th.classList.add('dragging');});
    th.addEventListener('dragend',()=>{draggedColumn=null;th.classList.remove('dragging');});
    th.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='move';});
    th.addEventListener('drop',event=>{event.preventDefault();moveColumn(draggedColumn||event.dataTransfer.getData('text/plain'),col);});
   }
   header.append(th);
  }
  return header;
 };
 $('head').replaceChildren(makeHeader(false));
 $('sticky-head').replaceChildren(makeHeader(true));
}
function render(){
 if(resettingFilters||!companyFilter||!atsFilter||!remoteFilter||!experienceFilter)return;
 const levels=experienceFilter.values();
 filtered=JobFilters.selectRows(rows,{
  query:$('query').value,remotePolicies:remoteFilter.values(),
  companies:companyFilter.values(),atsProviders:atsFilter.values(),
  levels:levels.filter(Boolean),includeUnspecified:levels.includes(''),levelsActive:true
 });
 renderHeader();
 const fragment=document.createDocumentFragment();
 for(const row of filtered){
  const tr=document.createElement('tr');
  for(const key of columns){
   const td=document.createElement('td'),value=String(row[key]??'');td.dataset.column=key;
   if(key==='job_url'&&/^https?:\/\//i.test(value)){const a=document.createElement('a');a.href=value;a.target='_blank';a.rel='noopener noreferrer';a.textContent='View posting';td.append(a);}
   else if(['job_responsibilities','experience_required'].includes(key)&&value){const ul=document.createElement('ul');ul.tabIndex=0;ul.setAttribute('aria-label',key+' for '+row.job_title);for(const line of value.split('\n').filter(Boolean)){const li=document.createElement('li');li.textContent=line.replace(/^• /,'');ul.append(li);}td.classList.add('details-list');td.append(ul);}
   else if(key==='full_job_post'){AdvertisementPreview.addButton(row,td);}
   else if(key==='date_added_to_dataset'){td.textContent=value;td.classList.add('date-added-to-dataset');}
   else{td.textContent=value||(key==='job_experience_level'?'Not specified':'—');if(!value)td.classList.add('empty');}
   if(key==='job_title')td.classList.add('title');if(key==='job_summary')td.classList.add('summary');if(key==='company_name')td.classList.add('company');if(key==='salary')td.classList.add('salary');if(key==='job_experience_level')td.classList.add('experience-level');tr.append(td);
  }
  fragment.append(tr);
 }
 $('results').replaceChildren(fragment);
 $('status').textContent=`${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} jobs`;
 $('empty').hidden=filtered.length!==0;
 $('range').textContent=filtered.length?`Showing all ${filtered.length.toLocaleString()} matching postings`:'No matching rows';
 document.dispatchEvent(new Event('job-listings-rendered'));
}
async function start(){
 try{
  const response=await fetch('jobs.json',{cache:'no-store'});if(!response.ok)throw new Error('Job data HTTP '+response.status);
  const data=await response.json();rows=data.jobs;
  const options=key=>[...new Set(rows.map(row=>String(row[key]??'')))].sort().map(value=>({value,label:value||'Not specified'}));
  companyFilter=CheckboxFilter.create($('company'),{label:'Company',options:options('company_name'),selected:'all',onChange:render});
  const atsOptions=options('ats_provider');
  if(!atsOptions.some(option=>option.value===''))atsOptions.push({value:'',label:'Not specified'});
  atsFilter=CheckboxFilter.create($('ats'),{label:'ATS',options:atsOptions,selected:'all',onChange:render});
  remoteFilter=CheckboxFilter.create($('remote'),{label:'Remote policy',options:['in-office','remote','hybrid',''].map(value=>({value,label:value||'Not specified'})),selected:'all',onChange:render});
  const levels=['internship','entry-level / junior','mid-level / intermediate','senior','lead','staff','principal','manager','director','executive',''];
  experienceFilter=CheckboxFilter.create($('experience-levels'),{label:'Experience level',options:levels.map(value=>({value,label:value||'Not specified'})),selected:'all',onChange:render});
  $('query').addEventListener('input',render);
  $('reset').addEventListener('click',()=>{
   resettingFilters=true;
   $('query').value='';
   companyFilter.reset();atsFilter.reset();remoteFilter.reset();experienceFilter.reset();
   resettingFilters=false;render();
  });
  $('column-order-reset').addEventListener('click',()=>{columns=[...defaultColumns];try{localStorage.removeItem(columnOrderStorageKey);}catch{/* Reset still works without storage. */}render();});
  render();
 }catch(error){$('status').textContent='Could not load jobs. Please reload or download the CSV.';$('status').classList.add('error');console.error(error);}
}
start();
