/**
 * Database barrel export
 */

export {
  initDatabase,
  saveDatabase,
  closeDatabase,
  getVideoByPath,
  getAllVideos,
  getVideosByStatus,
  getIncompleteVideos,
  insertVideo,
  updateVideoStatus,
  updateVideoNewName,
  getConfig,
  setConfig,
  getDatabaseDir,
} from './database.js';
