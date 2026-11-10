<?php
declare(strict_types=1);
require_once __DIR__ . '/../server/bootstrap.php';
require __DIR__ . '/helpers.php';
function settings_store(): array {
    $s = rummy_migrate(['sessions'=>[], 'rooms'=>[], 'limits'=>[]]);
    foreach (['a','b'] as $id) rummy_register($s, $id, "player_$id", "Player $id", 'test-password-long');
    $s['sessions']['settings-token'] = ['id'=>'a','accountId'=>'a','csrf'=>'settings-csrf','expires'=>rummy_now()+60000];
    $_COOKIE['mr_session']='settings-token'; $_SERVER['HTTP_X_CSRF_TOKEN']='settings-csrf'; $_SERVER['HTTP_ORIGIN']='http://localhost'; $_SERVER['HTTP_HOST']='localhost'; $_GET=[];
    return $s;
}
function settings_config(): array { return ['app_origin'=>'']; }
function feedback_input(string $id = 'a'): array { return ['id'=>str_repeat($id,32),'category'=>'idea','message'=>'A better table view.']; }
test('Username rename preserves account identity, password, points, sessions and active tables', function() {
    $s=settings_store(); $r=rummy_create('a','Player a'); rummy_join($r,'b','Player b',''); rummy_start($r,'a',array_keys($s['users'])); $s['rooms'][$r['code']]=$r;
    $before=$s; $p=rummy_handle($s,settings_config(),'username','POST',['username'=>'NEW_NAME','currentPassword'=>'test-password-long']);
    same($p['username'],'new_name'); same($p['id'],'a'); same(rummy_verify_login($s,'new_name','test-password-long'),'a');
    rejects(function() use (&$s) { rummy_verify_login($s,'player_a','test-password-long'); },'Incorrect');
    same($s['sessions'],$before['sessions']); same($s['rooms'],$before['rooms']); same($s['pointEvents'],$before['pointEvents']);
    $user=$before['users']['a']; $user['username']='new_name'; same($s['users']['a'],$user);
    same(rummy_profile($s,'a')['username'],'new_name');
});
test('Rename rejects wrong passwords, duplicate usernames and malformed/tampered input', function() {
    $s=settings_store(); $before=$s['users']; $names=$s['usernames'];
    foreach ([['username'=>'new_name','currentPassword'=>'wrong-password'],['username'=>'PLAYER_B','currentPassword'=>'test-password-long'],['username'=>'../invalid','currentPassword'=>'test-password-long'],['username'=>'new_name','currentPassword'=>'test-password-long','points'=>99999]] as $input) {
        rejects(function() use (&$s,$input) { rummy_handle($s,settings_config(),'username','POST',$input); });
        same($s['users'],$before); same($s['usernames'],$names);
    }
});
test('Account settings require authentication, origin and CSRF verification', function() {
    $s=settings_store(); $input=['username'=>'new_name','currentPassword'=>'test-password-long'];
    $_SERVER['HTTP_X_CSRF_TOKEN']='bad'; rejects(function() use (&$s,$input) { rummy_handle($s,settings_config(),'username','POST',$input); },'verification');
    rejects(function() use (&$s) { rummy_handle($s,settings_config(),'feedback','POST',feedback_input()); },'verification');
    $_SERVER['HTTP_X_CSRF_TOKEN']='settings-csrf'; $_SERVER['HTTP_ORIGIN']='https://evil.example';
    rejects(function() use (&$s) { rummy_handle($s,settings_config(),'feedback','POST',feedback_input()); },'verification');
    $_SERVER['HTTP_ORIGIN']='http://localhost'; unset($s['sessions']['settings-token']['accountId']);
    rejects(function() use (&$s,$input) { rummy_handle($s,settings_config(),'username','POST',$input); },'Sign in');
    rejects(function() use (&$s) { rummy_handle($s,settings_config(),'feedback','POST',feedback_input()); },'Sign in');
    $_GET=['id'=>str_repeat('a',32)]; rejects(function() use (&$s) { rummy_handle($s,settings_config(),'feedback','GET',[]); },'Sign in');
});
test('Feedback persists one private receipt per unchanged request ID', function() {
    $s=settings_store(); $before=$s; $input=feedback_input(); $input['message']='<script>alert(1)</script>';
    $receipt=rummy_handle($s,settings_config(),'feedback','POST',$input); same($receipt['message'],$input['message']); check(!isset($receipt['userId']));
    same(rummy_handle($s,settings_config(),'feedback','POST',$input),$receipt); same(count($s['feedback']),1);
    same($s['users'],$before['users']); same($s['rooms'],$before['rooms']); same($s['pointEvents'],$before['pointEvents']);
    same(rummy_feedback_receipt($s,'a',$input['id']),$receipt);
    rejects(fn()=>rummy_feedback_receipt($s,'b',$input['id']),'not found');
    $changed=$input; $changed['message']='Different'; rejects(function() use (&$s,$changed) { rummy_submit_feedback($s,'a',$changed); },'different submission');
    rejects(function() use (&$s,$input) { rummy_submit_feedback($s,'b',$input); },'different submission');
    $saved=json_decode(json_encode($s),true); same(rummy_feedback_receipt($saved,'a',$input['id']),$receipt);
});
test('Feedback validates size, categories and fields and bounds new submissions', function() {
    $s=settings_store();
    foreach ([['message'=>'  '],['message'=>str_repeat('x',1001)],['category'=>'unknown'],['message'=>"\xFF"],['id'=>'../bad'],['userId'=>'b']] as $change) {
        $input=array_merge(feedback_input(),$change); rejects(function() use (&$s,$input) { rummy_submit_feedback($s,'a',$input); });
    }
    for($i=0;$i<5;$i++) rummy_submit_feedback($s,'a',['id'=>str_pad(dechex($i),32,'0',STR_PAD_LEFT),'category'=>'idea','message'=>'Valid suggestion']);
    rejects(function() use (&$s) { rummy_submit_feedback($s,'a',feedback_input()); },'Too many');
    same(count($s['feedback']),5);
    $old=['id'=>str_repeat('0',32),'category'=>'idea','message'=>'Valid suggestion']; same(rummy_submit_feedback($s,'a',$old)['id'],$old['id']);
    $full=settings_store(); $full['feedback']=array_fill(0,1000,[]);
    rejects(function() use (&$full) { rummy_submit_feedback($full,'a',feedback_input()); },'full');
});
echo "\n$passed account settings and feedback tests passed.\n";
