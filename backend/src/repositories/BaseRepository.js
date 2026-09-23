export class BaseRepository {
  async saveUsageLog() {
    throw new Error('saveUsageLog() must be implemented');
  }

  async saveEntries() {
    throw new Error('saveEntries() must be implemented');
  }

  async getSystemConfig() {
    throw new Error('getSystemConfig() must be implemented');
  }

  async updateSystemConfig() {
    throw new Error('updateSystemConfig() must be implemented');
  }
}
