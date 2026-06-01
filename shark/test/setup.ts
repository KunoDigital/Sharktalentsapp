import '@testing-library/jest-dom/vitest';

// Mock import.meta.env for tests (config.ts requires these)
import.meta.env.VITE_API_BASE = 'http://localhost:3002/api';
import.meta.env.VITE_APP_VERSION = 'test';
import.meta.env.VITE_APP_BASE_URL = 'http://localhost:3000';
import.meta.env.VITE_CLIENT_HOSTING_PATH = '/';
import.meta.env.VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_test';
