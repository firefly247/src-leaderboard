/** Read-only verification through the deployed independent API; logs only counts. */
function verifyIndependentApiAdministrator(){
  var endpoint=supabaseSettings_().url+'/functions/v1/club-api';
  function call(action,payload,token){
    var response=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',payload:JSON.stringify({action:action,payload:payload||{},adminToken:token||''}),muteHttpExceptions:true});
    var data=JSON.parse(response.getContentText());if(response.getResponseCode()!==200||!data.ok)throw new Error('새 API 검증 실패: '+action);return data;
  }
  var login=call('adminLogin',{password:prop_('ADMIN_PASSWORD')});if(!login.adminToken||login.adminToken.length!==72)throw new Error('관리자 인증 검증 실패');
  var players=call('adminList',{view:'player-birth-years'},login.adminToken),races=call('raceLineupAdminData',{},login.adminToken),training=call('trainingDraftGet',{},login.adminToken);
  console.log(JSON.stringify({verified:true,independentApi:true,administratorLogin:true,players:players.players.length,races:races.races.length,trainingSessions:training.sessions.length,secretsLogged:false}));
}
