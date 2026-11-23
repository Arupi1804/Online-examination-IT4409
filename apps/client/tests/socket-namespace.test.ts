import { expect, test } from 'vitest';
import { examSocketUrl } from '../src/socket/namespace';

test('same-origin sockets connect to the exam namespace', () => {
  expect(examSocketUrl()).toBe('/exam');
  expect(examSocketUrl('')).toBe('/exam');
});

test.each([
  'https://api.example.com',
  'https://api.example.com/',
  'https://api.example.com/exam',
  'https://api.example.com/api/v1?ignored=1#section',
])('normalizes %s to exactly one exam namespace', (origin) => {
  expect(examSocketUrl(origin)).toBe('https://api.example.com/exam');
});
