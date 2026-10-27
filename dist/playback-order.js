const playable = track => track && typeof track.id === 'string' && track.id && !track.isLive && !(Number(track.duration) > 10800);
const unique = tracks => [...new Map(tracks.filter(playable).map(track => [track.id, track])).values()];

export class PlaybackOrder {
  constructor() { this.items=[];this.index=-1;this.current=null;this.origin='list';this.contextOrigin='list';this.visited=new Set();this.back=[];this.forward=[]; }
  start(track, tracks = [], origin = 'list') {
    this.items=unique(tracks);this.index=this.items.findIndex(item=>item.id===track.id);
    if(this.index<0){this.items=[track,...this.items];this.index=0;}
    this.current=track;this.origin=origin;this.contextOrigin=origin;this.visited=new Set([track.id]);this.back=[];this.forward=[];
  }
  update(track) { if(this.current?.id===track.id)this.current=track; }
  snapshot() { return this.current ? {track:this.current,index:this.index,origin:this.origin} : null; }
  upcoming(queue = [], recommendations = []) {
    const entries=[],seen=new Set([this.current?.id]);
    const add=entry=>{if(playable(entry.track)&&!seen.has(entry.track.id)){seen.add(entry.track.id);entries.push(entry);}};
    for(const track of queue)add({track,index:this.index,origin:'queue',kind:'queue'});
    for(const entry of [...this.forward].reverse())add({...entry,kind:'forward'});
    for(let index=this.index+1;index<this.items.length;index++){
      const track=this.items[index];if(!this.visited.has(track.id))add({track,index,origin:this.contextOrigin,kind:'list'});
    }
    for(const track of recommendations)if(!this.visited.has(track.id))add({track,index:this.index,origin:'recommendation',kind:'recommendation'});
    return entries;
  }
  pick(queue = [], recommendations = []) { return this.upcoming(queue,recommendations)[0] || null; }
  advance(choice) {
    if(!choice)return null;
    const current=this.snapshot();if(current&&current.track.id!==choice.track.id)this.back.push(current);
    if(this.back.length>100)this.back.shift();
    if(choice.kind==='forward')this.forward.pop();else this.forward=[];
    this.current=choice.track;this.index=choice.index??this.index;this.origin=choice.origin||'list';this.visited.add(choice.track.id);
    return choice.track;
  }
  previous() {
    let previous=this.back.pop();
    if(!previous&&this.index>0)previous={track:this.items[this.index-1],index:this.index-1,origin:'list'};
    if(!previous)return null;
    const current=this.snapshot();if(current)this.forward.push(current);
    this.current=previous.track;this.index=previous.index;this.origin=previous.origin;this.visited.add(previous.track.id);
    return previous.track;
  }
}
