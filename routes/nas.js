// NAS (local network-attached-storage) support has been removed from this
// application entirely — there is no local file archive, no NAS route
// mounted in app.js, and no NAS-related data model. This file is kept only
// as an inert placeholder because this deployment cannot delete files from
// the repository; it is not required by, and not reachable from, anywhere
// in the app.
module.exports = require('express').Router();
