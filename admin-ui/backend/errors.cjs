function error(status, code, uncertain = false) { return Object.assign(new Error(code), {status, code, uncertain}); }
module.exports = {error};
