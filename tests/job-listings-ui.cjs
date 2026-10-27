const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../site');
const rows = [
  {job_url:'https://example.com/1',job_title:'One',company_name:'Alpha',ats_provider:'Workday',remote_policy:'remote; hybrid',job_experience_level:'senior',job_id:'1'},
  {job_url:'https://example.com/2',job_title:'Two',company_name:'Beta',ats_provider:'',remote_policy:'in-office',job_experience_level:'senior',job_id:'2'},
  {job_url:'https://example.com/3',job_title:'Three',company_name:'Alpha',ats_provider:'',remote_policy:'',job_experience_level:'senior',job_id:'3'}
];
let server, browser, origin;
before(async () => {
  server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (pathname === '/Job-Listings/jobs.json') {res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({jobs:rows}));}
    const file = path.resolve(root,'.'+pathname,pathname.endsWith('/')?'index.html':'');
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file)) {res.writeHead(404); return res.end();}
    res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript'})[path.extname(file)]||'text/plain'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
});
after(async()=>{if(browser)await browser.close(); if(server)await new Promise(resolve=>server.close(resolve));});
async function open(){const page=await browser.newPage({viewport:{width:1280,height:800}}); await page.goto(origin+'/Job-Listings/'); await page.waitForSelector('#results tr'); return page;}
async function choose(page, values){const d=page.locator('#remote details'); await d.locator('summary').click(); await d.getByRole('button',{name:'Clear all'}).click(); for(const value of values)await d.locator('input').filter({hasNot:page.locator('[type=search]')}).locator(`:scope[value=${JSON.stringify(value)}]`).check(); await d.locator('summary').click();}
const expectedColumns=['job_url','job_title','company_name','ats_provider','job_category','remote_policy','job_experience_level','is_fulltime','salary','job_summary','job_responsibilities','experience_required','full_job_post','city','country','date_posted','date_added_to_dataset','job_id'];
test('default columns use requested order and labels and preserve saved orders',async()=>{
 const page=await open(); try{
  assert.deepEqual(await page.locator('#sticky-head th').evaluateAll(ths=>ths.map(th=>th.dataset.column)),expectedColumns);
  assert.deepEqual(await page.locator('#sticky-head th').evaluateAll(ths=>ths.map(th=>th.textContent)),expectedColumns.map(key=>({company_name:'company',ats_provider:'ats'})[key]||key));
  assert.equal(await page.locator('#results tr:first-child td[data-column=company_name]').textContent(),'Alpha');
  assert.equal(await page.locator('#results tr:first-child td[data-column=ats_provider]').textContent(),'Workday');
  const saved=[...expectedColumns].reverse(); await page.evaluate(order=>localStorage.setItem('job-listings-column-order-v1',JSON.stringify(order)),saved); await page.reload(); await page.waitForSelector('#results tr');
  assert.deepEqual(await page.locator('#sticky-head th').evaluateAll(ths=>ths.map(th=>th.dataset.column)),saved);
  await page.click('#column-order-reset'); assert.deepEqual(await page.locator('#sticky-head th').evaluateAll(ths=>ths.map(th=>th.dataset.column)),expectedColumns);
 }finally{await page.close();}
});

test('intro describes saved job posts',async()=>{const page=await open(); try{assert.equal(await page.locator('#snapshot').textContent(),'Search roles, compare requirements, and explore saved job posts.');}finally{await page.close();}});

test('date added header fits and stays aligned after reordering',async()=>{
 const page=await open(); try{
  await page.evaluate(()=>{const from=document.querySelector('#sticky-head [data-column="date_added_to_dataset"]'),to=document.querySelector('#sticky-head [data-column="job_title"]'); const dataTransfer=new DataTransfer(); from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer})); to.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));});
  await page.waitForTimeout(200);
  const dimensions=await page.evaluate(()=>{const h=document.querySelector('#sticky-head [data-column="date_added_to_dataset"]'), cell=document.querySelector('#results td[data-column="date_added_to_dataset"]'), style=getComputedStyle(h), canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;return {width:h.getBoundingClientRect().width,cell:cell.getBoundingClientRect().width,required:ctx.measureText(h.textContent).width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)};});
  assert(dimensions.width>=dimensions.required,JSON.stringify(dimensions)); assert(Math.abs(dimensions.width-dimensions.cell)<1,JSON.stringify(dimensions));
 }finally{await page.close();}
});

test('remote policy checkbox supports multiple selections, none and reset',async()=>{
 const page=await open(); try{
  const d=page.locator('#remote details'); assert.equal(await d.count(),1); assert.equal(await d.locator('summary').getAttribute('aria-label'),'Remote policy');
  assert(await d.locator('input[type=checkbox]').evaluateAll(inputs=>inputs.length>=4&&inputs.every(input=>input.checked)));
  assert.equal(await page.locator('#results tr').count(),3);
  await choose(page,['remote','in-office']); assert.deepEqual(await page.locator('#results td[data-column=job_id]').allTextContents(),['1','2']);
  await choose(page,[]); assert.equal(await page.locator('#results tr').count(),0);
  await page.click('#reset'); assert.equal(await page.locator('#results tr').count(),3); assert(await d.locator('input[type=checkbox]').evaluateAll(inputs=>inputs.every(input=>input.checked)));
 }finally{await page.close();}
});
