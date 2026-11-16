const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');let resolveRpc,loggedOut=0,painted=[];
const nodes=new Map();const $=name=>{if(!nodes.has(name))nodes.set(name,{textContent:''});return nodes.get(name);};
const context=vm.createContext({$,authStateVersion:1,authReady:false,signedInUser:null,accountOrders:[],verifiedPaymentUserId:'',paymentVerificationComplete:false,returnedOrderNumber:'',verifiedAdminUserId:'',paymentReturned:false,passwordRecoveryMode:false,resumeCheckoutAfterAuth:false,accountBackdrop:{classList:{contains:()=>false}},refreshAdminAccess(){},loadOrderHistory(){},renderMaintenanceMode(){},renderAccountState(){painted.push(context.signedInUser);},setTimeout(){},supabaseClient:{rpc:()=>new Promise(resolve=>{resolveRpc=resolve;}),auth:{signOut:async()=>{loggedOut++;}}}});
vm.runInContext(source.slice(source.indexOf('  async function applyAuthState('),source.indexOf('  if (supabaseClient) {\n    supabaseClient.auth.onAuthStateChange')),context);
(async()=>{
 const stale={user:{id:'owner'},access_token:'revoked-token'};
 const pending=context.applyAuthState('INITIAL_SESSION',stale,1);
 assert.equal(context.signedInUser,null,'Cached account must remain hidden while checking');
 resolveRpc({data:false,error:null});await pending;
 assert.equal(context.signedInUser,null);assert.equal(loggedOut,1);assert(painted.every(user=>user===null));
 context.authStateVersion=2;const valid=context.applyAuthState('INITIAL_SESSION',stale,2);resolveRpc({data:true,error:null});await valid;assert.equal(context.signedInUser.id,'owner');
 context.signedInUser=null;context.authStateVersion=3;const superseded=context.applyAuthState('INITIAL_SESSION',stale,3);context.authStateVersion=4;resolveRpc({data:true,error:null});await superseded;assert.equal(context.signedInUser,null,'Superseded check must not restore an account');
 context.authStateVersion=5;const unavailable=context.applyAuthState('INITIAL_SESSION',stale,5);resolveRpc({data:null,error:{message:'offline'}});await unavailable;assert.equal(context.signedInUser,null);
 console.log('Restored sessions passed: cached account hidden, revoked session removed, valid account restored, stale checks ignored and network failure closed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
