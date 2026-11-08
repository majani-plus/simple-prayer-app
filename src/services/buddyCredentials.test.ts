/**
 * The secret moved out of `expo-secure-store` and into the bridge module, so that a widget tap can
 * read it (D180). What these tests hold is the part with a person behind it: somebody who paired
 * before the update must not be asked to pair again.
 */

import {
  createBuddyCredentialStore,
  createMemorySecureStorage,
  createMigratingSecureStorage,
  type BuddyCredentials,
  type SecureStorage,
} from './buddyCredentials';

const KEY = 'buddyRelayCredentials';

const credentials: BuddyCredentials = {
  deviceId: 'a'.repeat(32),
  secret: 'b'.repeat(43),
};

function refusing(): SecureStorage {
  return {
    getItemAsync: async () => null,
    setItemAsync: async () => {
      throw new Error('keychain closed');
    },
    deleteItemAsync: async () => {
      throw new Error('keychain closed');
    },
  };
}

describe('the migration off expo-secure-store', () => {
  it('reads the bridge and never looks back when it has the secret', async () => {
    const bridge = createMemorySecureStorage({ [KEY]: JSON.stringify(credentials) });
    const legacy = createMemorySecureStorage();
    const look = jest.spyOn(legacy, 'getItemAsync');

    const store = createBuddyCredentialStore(createMigratingSecureStorage(bridge, legacy));

    await expect(store.read()).resolves.toEqual(credentials);
    expect(look).not.toHaveBeenCalled();
  });

  it('moves a secret left behind by the old app, and deletes the old copy', async () => {
    const bridge = createMemorySecureStorage();
    const legacy = createMemorySecureStorage({ [KEY]: JSON.stringify(credentials) });

    const store = createBuddyCredentialStore(createMigratingSecureStorage(bridge, legacy));

    await expect(store.read()).resolves.toEqual(credentials);
    await expect(bridge.getItemAsync(KEY)).resolves.toBe(JSON.stringify(credentials));
    await expect(legacy.getItemAsync(KEY)).resolves.toBeNull();
  });

  it('keeps the old copy when the bridge will not take it, and carries on', async () => {
    const legacy = createMemorySecureStorage({ [KEY]: JSON.stringify(credentials) });

    const store = createBuddyCredentialStore(createMigratingSecureStorage(refusing(), legacy));

    // Buddy mode works exactly as it did before D180: the app does all the telling.
    await expect(store.read()).resolves.toEqual(credentials);
    await expect(legacy.getItemAsync(KEY)).resolves.toBe(JSON.stringify(credentials));
  });

  it('looks in the old place once, not on every read', async () => {
    const bridge = createMemorySecureStorage();
    const legacy = createMemorySecureStorage();
    const look = jest.spyOn(legacy, 'getItemAsync');

    const store = createBuddyCredentialStore(createMigratingSecureStorage(bridge, legacy));

    await expect(store.read()).resolves.toBeNull();
    await expect(store.read()).resolves.toBeNull();
    expect(look).toHaveBeenCalledTimes(1);
  });

  it('saves to the bridge, where the widget can read it', async () => {
    const bridge = createMemorySecureStorage();
    const legacy = createMemorySecureStorage();

    const store = createBuddyCredentialStore(createMigratingSecureStorage(bridge, legacy));

    await expect(store.save(credentials)).resolves.toBe(true);
    await expect(bridge.getItemAsync(KEY)).resolves.toBe(JSON.stringify(credentials));
    await expect(legacy.getItemAsync(KEY)).resolves.toBeNull();
  });

  it('falls back to the old place rather than leaving buddy mode unable to start', async () => {
    const legacy = createMemorySecureStorage();

    const store = createBuddyCredentialStore(createMigratingSecureStorage(refusing(), legacy));

    await expect(store.save(credentials)).resolves.toBe(true);
    await expect(legacy.getItemAsync(KEY)).resolves.toBe(JSON.stringify(credentials));
  });

  it('says no when neither will take it, so nothing registers half-set-up', async () => {
    const store = createBuddyCredentialStore(createMigratingSecureStorage(refusing(), refusing()));
    await expect(store.save(credentials)).resolves.toBe(false);
  });

  it('clears both when buddy mode is switched off', async () => {
    const bridge = createMemorySecureStorage({ [KEY]: JSON.stringify(credentials) });
    const legacy = createMemorySecureStorage({ [KEY]: JSON.stringify(credentials) });

    const store = createBuddyCredentialStore(createMigratingSecureStorage(bridge, legacy));
    await store.clear();

    await expect(bridge.getItemAsync(KEY)).resolves.toBeNull();
    await expect(legacy.getItemAsync(KEY)).resolves.toBeNull();
  });
});
