export const testUsers = [
  {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'admin',
  },
  {
    id: '2',
    name: 'Jane Smith',
    email: 'jane@example.com',
    role: 'user',
  },
];

export const testApiResponses = {
  success: {
    status: 200,
    data: { message: 'Success' },
  },
  error: {
    status: 400,
    error: { message: 'Bad Request' },
  },
};

export function createTestUser(overrides = {}) {
  return {
    id: Math.random().toString(36).substring(7),
    name: 'Test User',
    email: 'test@example.com',
    role: 'user',
    createdAt: new Date(),
    ...overrides,
  };
}
