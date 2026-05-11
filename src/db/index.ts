/**
 * Database barrel export
 */

export {
  initDatabase,
  saveDatabase,
  closeDatabase,
  getVideoByPath,
  getVideoById,
  getVideoByHash,
  getAllVideos,
  getVideosByStatus,
  getIncompleteVideos,
  insertVideo,
  updateVideoStatus,
  updateVideoNewName,
  updateVideoPath,
  getConfig,
  setConfig,
  getDatabaseDir,
  clearAllVideos,
  resetVideoByFilename,
} from './database.js';
