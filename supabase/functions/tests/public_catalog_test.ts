const assert = (value: unknown) => { if (!value) throw new Error("Assertion failed"); };
Deno.test("public catalog parses data without executing scripts, ignores client URLs and coalesces reads", async () => {
  const realFetch=fetch,serve=Deno.serve;
  const oldEndpoint=Deno.env.get("APPS_SCRIPT_ORDER_ENDPOINT");
  Deno.env.set("APPS_SCRIPT_ORDER_ENDPOINT","https://script.google.com/macros/s/configured/exec");
  let handler: (request: Request)=>Promise<Response>, calls=0;
  Deno.serve=((h:typeof handler)=>{handler=h;}) as typeof Deno.serve;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));assert(url.hostname==='script.google.com');assert(url.pathname.includes('/configured/'));calls++;
    return new Response('receiveTrikonicProducts({"ready":true,"products":[{"id":"1","name":"<img onerror=alert(1)>"}]});');
  };
  try{
    await import('../public-catalog/index.ts?json-test');
    const responses=await Promise.all([handler!(new Request('https://backend.test?endpoint=http://127.0.0.1')),handler!(new Request('https://backend.test'))]);
    assert(calls===1);
    for(const response of responses){assert(response.status===200);assert(response.headers.get('content-type')?.startsWith('application/json'));assert(response.headers.get('x-content-type-options')==='nosniff');const data=await response.json();assert(data.ready&&data.products[0].id==='1');}
    assert((await handler!(new Request('https://backend.test',{method:'POST'}))).status===405);
    globalThis.fetch=async()=>new Response('receiveTrikonicProducts({"ready":true,"products":[]});evil()');
    await import('../public-catalog/index.ts?invalid-script-test');
    assert((await handler!(new Request('https://backend.test'))).status>=400);
  }finally{globalThis.fetch=realFetch;Deno.serve=serve;if(oldEndpoint)Deno.env.set('APPS_SCRIPT_ORDER_ENDPOINT',oldEndpoint);else Deno.env.delete('APPS_SCRIPT_ORDER_ENDPOINT');}
});
