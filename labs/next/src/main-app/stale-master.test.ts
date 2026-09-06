import { describe, expect, it } from 'vitest';
import { applyWorkingTape, type BookProject } from './store';
import { chapterListenFile } from './vault-media';

describe('master invalidation after editing', () => {
  it('clears the old master from the current tape slots without deleting audio', () => {
    const project = { chapters: [{ id:'one', workingFile:'working.wav', masteredFile:'old.wav', mastered:true, hasMasteredAudio:true }] } as BookProject;
    const edited = applyWorkingTape(project,'one','pickup.wav');
    expect(edited.chapters[0]).toMatchObject({workingFile:'pickup.wav', mastered:false, hasMasteredAudio:false});
    expect(edited.chapters[0].masteredFile).toBeUndefined();
    expect(project.chapters[0].masteredFile).toBe('old.wav');
  });
  it('does not play a stale master loaded from an older project', () => {
    const chapter = {mastered:false,masteredFile:'old.wav',workingFile:'new.wav'};
    expect(chapterListenFile(chapter,true)).toBe('new.wav');
    expect(chapterListenFile(chapter,false)).toBeUndefined();
    expect(chapterListenFile({...chapter,mastered:true},false)).toBe('old.wav');
  });
});
