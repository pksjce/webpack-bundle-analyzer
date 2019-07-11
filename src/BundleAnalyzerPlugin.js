const bfj = require('bfj');
const path = require('path');
const mkdir = require('mkdirp');
const {bold} = require('chalk');

const Logger = require('./Logger');
const viewer = require('./viewer');

class BundleAnalyzerPlugin {

  constructor(opts) {
    this.opts = {
      analyzerMode: 'server',
      analyzerHost: '127.0.0.1',
      analyzerPort: 8888,
      reportFilename: 'report.html',
      defaultSizes: 'parsed',
      openAnalyzer: true,
      generateStatsFile: false,
      statsFilename: 'stats.json',
      statsOptions: null,
      excludeAssets: null,
      logLevel: 'info',
      // deprecated
      startAnalyzer: true,
      ...opts
    };

    this.server = null;
    this.logger = new Logger(this.opts.logLevel);
  }

  apply(compiler) {
    this.compiler = compiler;
    const emit = (compiler, callback) => {
      callback = callback || (() => {});
      const stats = compiler.getStats().toJson(this.opts.statsOptions);
      const analyzerOpts = {logger: this.logger, excludeAssets: this.opts.excludeAssets};

      const chartData = JSON.stringify(viewer.getChartData(analyzerOpts, stats, this.getBundleDirFromCompiler()));

      const actions = [];

      if (this.opts.generateStatsFile) {
        actions.push(() => this.generateStatsFile(compiler, chartData));
      }

      // Handling deprecated `startAnalyzer` flag
      if (this.opts.analyzerMode === 'server' && !this.opts.startAnalyzer) {
        this.opts.analyzerMode = 'disabled';
      }

      if (this.opts.analyzerMode === 'server') {
        actions.push(() => this.startAnalyzerServer(stats));
      } else if (this.opts.analyzerMode === 'static') {
        actions.push(() => this.generateStaticReport(stats));
      }

      if (actions.length) {
        // Making analyzer logs to be after all webpack logs in the console
        setImmediate(async () => {
          try {
            await Promise.all(actions.map(action => action()));
            callback();
          } catch (e) {
            callback(e);
          }
        });
      } else {
        callback();
      }
    };

    if (compiler.hooks) {
      compiler.hooks.emit.tapAsync('webpack-bundle-analyzer', emit);
    } else {
      compiler.plugin('emit', emit);
    }
  }

  async generateStatsFile(curCompiler, stats) {
    const statsFilepath = path.resolve(this.compiler.outputPath, this.opts.statsFilename);
    mkdir.sync(path.dirname(statsFilepath));
    let err;
    try {
      await Promise.resolve(stats)
        .then(() => {
          // Handle errors.
          if (err) {
            curCompiler.errors.push(err);
            throw err;
          }

          // Add to assets.
          curCompiler.assets[this.opts.statsFilename] = {
            source() {
              return stats;
            },
            size() {
              return stats.length;
            }
          };
        });

      this.logger.info(
        `${bold('Webpack Bundle Analyzer')} saved stats file to ${bold(statsFilepath)}`
      );
    } catch (error) {
      this.logger.error(
        `${bold('Webpack Bundle Analyzer')} error saving stats file to ${bold(statsFilepath)}: ${error}`
      );
    }
  }

  async startAnalyzerServer(stats) {
    if (this.server) {
      (await this.server).updateChartData(stats);
    } else {
      this.server = viewer.startServer(stats, {
        openBrowser: this.opts.openAnalyzer,
        host: this.opts.analyzerHost,
        port: this.opts.analyzerPort,
        bundleDir: this.getBundleDirFromCompiler(),
        logger: this.logger,
        defaultSizes: this.opts.defaultSizes,
        excludeAssets: this.opts.excludeAssets
      });
    }
  }

  async generateStaticReport(stats) {
    await viewer.generateReport(stats, {
      openBrowser: this.opts.openAnalyzer,
      reportFilename: path.resolve(this.compiler.outputPath, this.opts.reportFilename),
      bundleDir: this.getBundleDirFromCompiler(),
      logger: this.logger,
      defaultSizes: this.opts.defaultSizes,
      excludeAssets: this.opts.excludeAssets
    });
  }

  getBundleDirFromCompiler() {
    switch (this.compiler.outputFileSystem.constructor.name) {
      case 'MemoryFileSystem':
        return null;
      // Detect AsyncMFS used by Nuxt 2.5 that replaces webpack's MFS during development
      // Related: #274
      case 'AsyncMFS':
        return null;
      default:
        return this.compiler.outputPath;
    }
  }

}

module.exports = BundleAnalyzerPlugin;
