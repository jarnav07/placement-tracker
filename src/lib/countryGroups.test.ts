import { countryGroup } from './countryGroups'

describe('countryGroup', () => {
  it('keeps UK locations in UK', () => expect(countryGroup('United Kingdom', 'London')).toBe('UK'))
  it('puts Rocket Lab New Zealand in Oceania', () => expect(countryGroup('New Zealand', 'Auckland', 'Rocket Lab')).toBe('Oceania'))
  it('puts Rocket Lab NZ in Oceania even with a generic country label', () => expect(countryGroup('NZ / Oceania', 'Auckland', 'Rocket Lab')).toBe('Oceania'))
  it('puts Australia in Oceania', () => expect(countryGroup('Australia', 'Sydney')).toBe('Oceania'))
  it('puts Canada in America', () => expect(countryGroup('Canada', 'Toronto')).toBe('America'))
  it('puts Germany in Europe', () => expect(countryGroup('Germany', 'Munich')).toBe('Europe'))
  it('puts Japan in Asia', () => expect(countryGroup('Japan', 'Tokyo')).toBe('Asia'))
})
