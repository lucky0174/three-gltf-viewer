const THREE = require('three');
const Handlebars = require('handlebars');
const glob = require('glob-to-regexp');
const registry = require('../lib/gltf-generator-registry');

const SEVERITY_MAP = ['Errors', 'Warnings', 'Infos', 'Hints'];

const validator = window.gltfValidator;

class ValidationController {

  /**
   * @param  {Element} el
   */
  constructor (el) {
    this.el = el;
    this.report = null;

    this.toggleTpl = Handlebars.compile(document.querySelector('#report-toggle-template').innerHTML);
    this.toggleEl = document.createElement('div');
    this.toggleEl.classList.add('report-toggle-wrap', 'hidden');
    this.el.appendChild(this.toggleEl);

    Handlebars.registerPartial('issuesTable', document.querySelector('#report-table-partial').innerHTML);

    this.reportTpl = Handlebars.compile(document.querySelector('#report-template').innerHTML);
  }

  /**
   * Runs validation against the given file URL and extra resources.
   * @param  {string} rootFile
   * @param  {string} rootPath
   * @param  {Map<string, File>} assetMap
   * @return {Promise}
   */
  validate (rootFile, rootPath, assetMap) {
    // TODO: This duplicates a request of the three.js loader, and could
    // take advantage of THREE.Cache after r90.
    return fetch(rootFile)
      .then((response) => response.arrayBuffer())
      .then((buffer) => validator.validateBytes(new Uint8Array(buffer), {
        externalResourceFunction: (uri) =>
          this.resolveExternalResource(uri, rootFile, rootPath, assetMap)
      }))
      .then((report) => this.setReport(report))
      .catch((e) => this.setReportException(e));
  }

  /**
   * Loads a resource (either locally or from the network) and returns it.
   * @param  {string} uri
   * @param  {string} rootFile
   * @param  {string} rootPath
   * @param  {Map<string, File>} assetMap
   * @return {Promise<Uint8Array>}
   */
  resolveExternalResource (uri, rootFile, rootPath, assetMap) {
    const baseURL = THREE.LoaderUtils.extractUrlBase(rootFile);
    const normalizedURL = rootPath + decodeURI(uri) // validator applies URI encoding.
      .replace(baseURL, '')
      .replace(/^(\.?\/)/, '');

    let objectURL;

    if (assetMap.has(normalizedURL)) {
      const object = assetMap.get(normalizedURL);
      objectURL = URL.createObjectURL(object);
    }

    return fetch(objectURL || (baseURL + uri))
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (objectURL) URL.revokeObjectURL(objectURL);
        return new Uint8Array(buffer);
      });
  }

  /**
   * @param {GLTFValidator.Report} report
   */
  setReport (report) {
    const generatorID = report && report.info && report.info.generator || '';
    const generator = registry.generators
      .find((tool) => {
        if (tool.generator.indexOf('*') === -1) {
          return tool.generator === generatorID;
        }
        return glob(tool.generator).test(generatorID);
      });
    if (generator) {
      if (generator.name !== generator.author) {
        generator.name = `${generator.name} by ${generator.author}`;
      }
    }
    report.generator = generator;

    report.issues.maxSeverity = -1;
    SEVERITY_MAP.forEach((severity, index) => {
      if (report.issues[`num${severity}`] > 0 && report.issues.maxSeverity === -1) {
        report.issues.maxSeverity = index;
      }
    });
    report.errors = report.issues.messages.filter((msg) => msg.severity === 0);
    report.warnings = report.issues.messages.filter((msg) => msg.severity === 1);
    report.infos = report.issues.messages.filter((msg) => msg.severity === 2);
    report.hints = report.issues.messages.filter((msg) => msg.severity === 3);
    groupMessages(report);
    this.report = report;

    this.toggleEl.innerHTML = this.toggleTpl(report);
    this.showToggle();
    this.bindListeners();

    function groupMessages (report) {
      const CODES = {
        ACCESSOR_NON_UNIT: {
          message: '{count} accessor elements not of unit length: 0. [AGGREGATED]',
          pointerCounts: {}
        },
        ACCESSOR_ANIMATION_INPUT_NON_INCREASING: {
          message: '{count} animation input accessor elements not in ascending order. [AGGREGATED]',
          pointerCounts: {}
        }
      };

      report.errors.forEach((message) => {
        if (!CODES[message.code]) return;
        if (!CODES[message.code].pointerCounts[message.pointer]) {
          CODES[message.code].pointerCounts[message.pointer] = 0;
        }
        CODES[message.code].pointerCounts[message.pointer]++;
      });
      report.errors = report.errors.filter((message) => {
        if (!CODES[message.code]) return true;
        if (!CODES[message.code].pointerCounts[message.pointer]) return true;
        return CODES[message.code].pointerCounts[message.pointer] < 2;
      });
      Object.keys(CODES).forEach((code) => {
        Object.keys(CODES[code].pointerCounts).forEach((pointer) => {
          report.errors.push({
            code: code,
            pointer: pointer,
            message: CODES[code].message.replace('{count}', CODES[code].pointerCounts[pointer])
          });
        });
      });
    }
  }

  /**
   * @param {Error} e
   */
  setReportException (e) {
    this.report = null;
    this.toggleEl.innerHTML = this.toggleTpl({reportError: e, level: 0});
    this.showToggle();
    this.bindListeners();
  }

  bindListeners () {
    const reportToggleBtn = this.toggleEl.querySelector('.report-toggle');
    reportToggleBtn.addEventListener('click', () => this.showLightbox());

    const reportToggleCloseBtn = this.toggleEl.querySelector('.report-toggle-close');
    reportToggleCloseBtn.addEventListener('click', (e) => {
      this.hideToggle();
      e.stopPropagation();
    });
  }

  showToggle () {
    this.toggleEl.classList.remove('hidden');
  }

  hideToggle () {
    this.toggleEl.classList.add('hidden');
  }

  showLightbox () {
    if (!this.report) return;
    const tab = window.open('', '_blank');
    tab.document.body.innerHTML = this.reportTpl(Object.assign({}, this.report, {location: location}));
  }
}

module.exports = ValidationController;
