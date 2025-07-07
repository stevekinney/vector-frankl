import { afterAll, beforeAll } from 'bun:test';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

afterAll(() => {
  // Cleanup any resources if needed
});
