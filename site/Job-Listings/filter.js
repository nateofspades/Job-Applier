(function(root){
'use strict';
function selectRows(rows,filters){
  const f=filters||{}, query=(f.query||'').trim().toLocaleLowerCase();
  const matches=(value,choice)=>!choice||(choice==='unknown'?value==='':value===choice);
  const policyToken=value=>{const token=value.trim().toLocaleLowerCase();return ({'fully remote':'remote','fully in office':'in-office','in office':'in-office'})[token]||token;};
  return rows.filter(r=>(!query||Object.values(r).some(v=>String(v).toLocaleLowerCase().includes(query)))
    &&matches(r.company_name,f.company)&&matches(r.job_category,f.category)&&matches(r.ats_provider??'',f.ats)
    &&(!f.remote||(f.remote==='unknown'?r.remote_policy==='':r.remote_policy.split(';').some(v=>policyToken(v)===policyToken(f.remote))))
    &&(!(f.levels?.length||f.includeUnspecified)||(r.job_experience_level ? r.job_experience_level.split(';').some(v=>(f.levels||[]).includes(v.trim())) : !!f.includeUnspecified)));
}
if(typeof module!=='undefined'&&module.exports) module.exports={selectRows};
else root.JobFilters={selectRows};
})(typeof window!=='undefined'?window:globalThis);
