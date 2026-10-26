'use strict';
const AdvertisementPreview=(()=>{
 let dialog,opener,previousOverflow,title,body;
 function createPanel(){
  dialog=document.createElement('dialog');dialog.className='advertisement-panel';dialog.id='advertisement-panel';dialog.setAttribute('aria-labelledby','advertisement-title');
  const header=document.createElement('div');header.className='advertisement-header';
  const label=document.createElement('div');label.className='muted';label.textContent='Full job post · archived source';
  title=document.createElement('h2');title.id='advertisement-title';
  const close=document.createElement('button');close.type='button';close.textContent='Close advertisement';close.addEventListener('click',()=>dialog.close());
  const note=document.createElement('p');note.className='muted';note.textContent='Original archived advertisement text, including bilingual and company/legal sections where supplied. Formatting is adapted for readability; this is not a live refresh.';
  header.append(label,title,close,note);
  body=document.createElement('div');body.className='advertisement-body';body.tabIndex=0;body.setAttribute('aria-label','Saved advertisement text');
  dialog.append(header,body);document.body.append(dialog);
  dialog.addEventListener('close',()=>{document.body.style.overflow=previousOverflow;if(opener?.isConnected){opener.setAttribute('aria-expanded','false');opener.focus({preventScroll:true});}});
 }
 function addButton(row,cell){
  const button=document.createElement('button');button.type='button';button.className='advertisement-open';button.textContent='Full job post';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','advertisement-panel');button.setAttribute('aria-expanded','false');
  button.addEventListener('click',()=>{if(!dialog)createPanel();opener=button;title.textContent=row.job_title;body.textContent=row.full_job_post||'';previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';button.setAttribute('aria-expanded','true');dialog.showModal();body.scrollTop=0;});
  cell.append(button);
 }
 return {addButton};
})();
