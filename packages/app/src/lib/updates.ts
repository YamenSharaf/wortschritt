/** The app updates itself on Android only (see updates.native.ts); the web preview has nothing to update. */
export const updatesSupported = false;
export const currentBuild = (): number => 0;
export const checkForUpdate = async (_?: { quiet?: boolean }): Promise<void> => {};
export const downloadAndInstall = async (): Promise<void> => {};
