import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackOrder } from '../dist/playback-order.js';
const a={id:'a',duration:60},b={id:'b',duration:60},c={id:'c',duration:60},q={id:'q',duration:60},r={id:'r',duration:60};
test('next follows the list from the selected result',()=>{
  const order=new PlaybackOrder();order.start(b,[a,b,c]);assert.equal(order.pick().track.id,'c');order.advance(order.pick());assert.equal(order.pick(),null);
});
test('editing the search results does not change the captured playback list',()=>{
  const results=[a,b,c],order=new PlaybackOrder();order.start(a,results);results.splice(1,2,q,r);assert.equal(order.pick().track.id,'b');
});
test('explicit queue interrupts the list and then returns to the next list item',()=>{
  const order=new PlaybackOrder();order.start(a,[a,b,c]);const queued=order.pick([q]);assert.equal(queued.kind,'queue');order.advance(queued);assert.equal(order.pick().track.id,'b');
});
test('a queued song is not played again when reached in the original list',()=>{
  const order=new PlaybackOrder();order.start(a,[a,b,c]);order.advance(order.pick([b]));assert.equal(order.pick().track.id,'c');
});
test('recommendations follow the original list, exclude repeats and unsupported durations',()=>{
  const order=new PlaybackOrder();order.start(a,[a,b]);assert.equal(order.pick([],[r]).track.id,'b');order.advance(order.pick());assert.equal(order.pick([],[a,{id:'long',duration:11000},r]).track.id,'r');order.advance(order.pick([],[r]));assert.equal(order.pick([],[a,b,r]),null);
});
test('previous and next traverse actual playback including queue overrides',()=>{
  const order=new PlaybackOrder();order.start(a,[a,b,c]);order.advance(order.pick([q]));order.advance(order.pick());assert.equal(order.current.id,'b');assert.equal(order.previous().id,'q');assert.equal(order.pick().track.id,'b');order.advance(order.pick());assert.equal(order.pick().track.id,'c');
});
test('previous from a selected middle item can go to the preceding list item',()=>{
  const order=new PlaybackOrder();order.start(b,[a,b,c]);assert.equal(order.previous().id,'a');assert.equal(order.pick().track.id,'b');
});
test('preview is deduplicated and does not advance playback',()=>{
  const order=new PlaybackOrder();order.start(a,[a,b,c]);assert.deepEqual(order.upcoming([a,q,q,b],[b,r]).map(entry=>entry.track.id),['q','b','c','r']);assert.equal(order.current.id,'a');assert.equal(order.index,0);
});
test('a selected recommendations list resumes after a queue override',()=>{
  const order=new PlaybackOrder();order.start(a,[a,b,c],'recommendation');order.advance(order.pick([q]));const following=order.pick();assert.equal(following.track.id,'b');assert.equal(following.origin,'recommendation');
});
