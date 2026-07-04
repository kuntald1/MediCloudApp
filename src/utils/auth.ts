import AsyncStorage from '@react-native-async-storage/async-storage';

// Token store with AsyncStorage persistence
// Survives app reloads and restarts

let _token: string = '';
let _user: any     = null;

export const API_BASE = 'https://medicloud.mooo.com';

const TOKEN_KEY = 'medicloud_token';
const USER_KEY  = 'medicloud_user';

// Save auth (called on login) — persists to storage
export const setAuth = async (token: string, user: any) => {
  _token = token;
  _user  = user;
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user ?? {}));
  } catch (e) {
    console.warn('Failed to persist auth', e);
  }
};

// Load auth from storage (called on app start) — returns true if valid session exists
export const loadAuth = async (): Promise<boolean> => {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const user  = await AsyncStorage.getItem(USER_KEY);
    if (token) {
      _token = token;
      _user  = user ? JSON.parse(user) : null;
      return true;
    }
  } catch (e) {
    console.warn('Failed to load auth', e);
  }
  return false;
};

export const getToken = () => _token;
export const getUser  = () => _user;

export const clearAuth = async () => {
  _token = '';
  _user  = null;
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
  } catch {}
};

export const authHeader = () => ({ Authorization: `Bearer ${_token}` });
