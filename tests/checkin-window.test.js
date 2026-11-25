const {test}=require('node:test');const assert=require('node:assert/strict');const {checkinWindow}=require('../checkin');
test('arrival window uses Philippine time, approval, date and inclusive opening boundary',()=>{
 const a={date:'2026-11-25',time_slot:'10:00',end_time:'10:30',status:'approved'};
 assert.equal(checkinWindow(a,new Date('2026-11-25T09:44:00+08:00')).eligible,false);
 assert.equal(checkinWindow(a,new Date('2026-11-25T09:45:00+08:00')).eligible,true);
 assert.equal(checkinWindow(a,new Date('2026-11-25T10:29:00+08:00')).eligible,true);
 assert.equal(checkinWindow(a,new Date('2026-11-25T10:30:00+08:00')).late,true);
 assert.equal(checkinWindow(a,new Date('2026-11-26T02:00:00+08:00')).eligible,false);
 for(const status of ['pending','cancelled','missed','rejected','completed'])assert.equal(checkinWindow({...a,status},new Date('2026-11-25T10:00:00+08:00')).eligible,false);
 assert.equal(checkinWindow({...a,status:'checked-in'},new Date('2026-11-25T10:00:00+08:00')).already_checked_in,true);
});
