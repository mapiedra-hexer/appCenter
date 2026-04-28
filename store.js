const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor(opts) {
    const userDataPath = app.getPath('userData');
    this.path = path.join(userDataPath, opts.configName + '.json');
    this.data = parseDataFile(this.path, opts.defaults);
  }
  
  get(key) {
    return this.data[key];
  }
  
  set(key, val) {
    this.data[key] = val;
    fs.writeFileSync(this.path, JSON.stringify(this.data));
  }
}

function parseDataFile(filePath, defaults) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath));
    return Object.assign({}, defaults, parsed);
  } catch(error) {
    return defaults;
  }
}

module.exports = Store;
