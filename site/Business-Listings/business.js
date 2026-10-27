'use strict';
(() => {
 const headers=[...document.querySelectorAll('thead th')];
 const index=key=>headers.findIndex(cell=>cell.dataset.column===key);
 const companyColumn=index('company_name'),atsColumn=index('ats_provider'),dateColumn=index('date_added_to_dataset');
 if(dateColumn>=0)for(const row of document.querySelectorAll('table tr'))row.cells[dateColumn]?.classList.add('date-added-to-dataset');
 const rows=[...document.querySelectorAll('tbody tr')].map(element=>({
  element,company:element.cells[companyColumn].textContent,
  provider:element.cells[atsColumn].textContent.trim()==='Not verified'?'':element.cells[atsColumn].textContent.trim(),
  searchText:element.textContent.toLocaleLowerCase()
 }));
 const search=document.getElementById('search');
 let companyFilter,atsFilter,resetting=false;
 function filterBusinesses(){
  if(resetting||!companyFilter||!atsFilter)return;
  const companies=new Set(companyFilter.values()),providers=new Set(atsFilter.values());
  const query=search.value.trim().toLocaleLowerCase();let count=0;
  for(const row of rows){
   row.element.hidden=!companies.has(row.company)||!providers.has(row.provider)||!row.searchText.includes(query);
   if(!row.element.hidden)count++;
  }
  document.getElementById('count').textContent=count===rows.length?`${count.toLocaleString()} businesses`:`${count.toLocaleString()} of ${rows.length.toLocaleString()} businesses`;
  document.getElementById('empty').hidden=count!==0;
 }
 const options=key=>[...new Set(rows.map(row=>row[key]))].sort().map(value=>({value,label:value||'Not specified'}));
 companyFilter=CheckboxFilter.create(document.getElementById('company'),{label:'Company',options:options('company'),selected:'all',onChange:filterBusinesses});
 const atsOptions=options('provider');
 if(!atsOptions.some(option=>option.value===''))atsOptions.push({value:'',label:'Not specified'});
 atsFilter=CheckboxFilter.create(document.getElementById('ats'),{label:'ATS',options:atsOptions,selected:'all',onChange:filterBusinesses});
 search.addEventListener('input',filterBusinesses);
 document.getElementById('reset').addEventListener('click',()=>{
  resetting=true;search.value='';companyFilter.reset();atsFilter.reset();resetting=false;filterBusinesses();
 });
 filterBusinesses();
})();
