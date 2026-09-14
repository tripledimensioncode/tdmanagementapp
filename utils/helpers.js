// Utility helper functions used in views and routes
const dayjs = require('dayjs');

module.exports.formatDate = function (date) {
  if (!date) return '';
  return dayjs(date).format('YYYY-MM-DD HH:mm');
};
