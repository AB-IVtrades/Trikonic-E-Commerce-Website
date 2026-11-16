const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=readFileSync('app.js','utf8');
const code=source.slice(source.indexOf('  async function confirmReturnedPayment()'),source.indexOf('  let manualMaintenance'));
(async()=>{
 const notices=[];let calls=0;
 const context=vm.createContext({paymentReturned:true,paymentVerificationRunning:false,paymentVerificationComplete:false,verifiedPaymentUserId:'',returnedOrderNumber:'',returnReference:'TRK-return-ref-123',signedInUser:{id:'customer'},supabaseClient:{functions:{invoke:async()=>{calls++;return{data:{status:'pending'}};}}},paymentNotice:(...args)=>notices.push(args),money:n=>`GHS ${n}`,URL,Response,location:{href:'https://trikonicimports.com/?payment=return&reference=TRK-return-ref-123#home'},history:{replaceState(){}},closeAccount(){},loadOrderHistory:async()=>{},setTimeout(){}});
 vm.runInContext(code,context);
 await vm.runInContext('confirmReturnedPayment()',context);
 assert.equal(notices.at(-1)[0],'Payment is still processing');assert.equal(context.paymentVerificationComplete,false);
 context.returnReference='';await vm.runInContext('confirmReturnedPayment()',context);assert.equal(calls,1);assert.equal(notices.at(-1)[0],'Payment reference missing');
 context.returnReference='TRK-return-ref-123';context.signedInUser=null;await vm.runInContext('confirmReturnedPayment()',context);assert.equal(calls,1);assert.equal(notices.at(-1)[0],'Sign in to verify your payment');
 context.signedInUser={id:'customer'};context.supabaseClient.functions.invoke=async()=>({error:new Error('Unavailable')});await vm.runInContext('confirmReturnedPayment()',context);assert.equal(context.paymentVerificationComplete,false);assert.equal(notices.at(-1)[0],'Payment could not be confirmed');
 context.supabaseClient.functions.invoke=async()=>({data:{status:'success',amount:520,orderNumber:'TRK-test-order'}});await vm.runInContext('confirmReturnedPayment()',context);assert.equal(context.paymentVerificationComplete,true);assert.equal(notices.at(-1)[0],'Payment successful');assert.equal(context.returnedOrderNumber,'TRK-test-order');
 console.log('Payment UI passed: forged/missing return reference, sign-in, pending, error and server-confirmed success.');
})().catch(error=>{console.error(error);process.exitCode=1;});
