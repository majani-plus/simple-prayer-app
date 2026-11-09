import { scriptFamilyFor } from '../script';

describe('scriptFamilyFor (D210)', () => {
  it('sets Arabic and Urdu apart, because their fonts differ', () => {
    expect(scriptFamilyFor('ar')).toBe('arabic');
    expect(scriptFamilyFor('ar-EG')).toBe('arabic');
    expect(scriptFamilyFor('ur')).toBe('urdu');
    expect(scriptFamilyFor('UR_pk')).toBe('urdu');
  });

  it('treats every other language, and none, as Latin', () => {
    for (const tag of ['en', 'tr', 'fr', '', null, undefined]) {
      expect(scriptFamilyFor(tag)).toBe('latin');
    }
  });
});
