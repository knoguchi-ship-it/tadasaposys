/**
 * Google Apps Script グローバル API のモック定義
 * jest の setupFiles として読み込まれる
 */

global.Logger = {
  log:   jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
};

global.SpreadsheetApp  = {};
global.GmailApp        = {};
global.CalendarApp     = {};
global.DriveApp        = {};
global.UrlFetchApp     = {};
global.Utilities       = {};
global.CacheService    = {};
global.LockService     = {};
global.ScriptApp       = {};
global.Session         = { getActiveUser: jest.fn(() => ({ getEmail: jest.fn(() => '') })) };
global.HtmlService     = {};
global.PropertiesService = {};
