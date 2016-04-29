'use strict';

const cluster = require('cluster');
const EventEmitter = require('events').EventEmitter;
const defaults = require('lodash.defaults');
const cpuCount = require('os').cpus().length;
const debug = require('debug')('throng');

const DEFAULT_OPTIONS = {
  workers: cpuCount,
  lifetime: Infinity,
  grace: 5000
};

const NOOP = () => {};

module.exports = function throng(options, startFunction) {
  options = options || {};
  let startFn = options.start || startFunction || options;
  let masterFn = options.master || NOOP;

  if (typeof startFn !== 'function') {
    throw new Error('Start function required');
  }
  if (cluster.isWorker) {
    return startFn(cluster.worker.id);
  }

  let opts = isNaN(options) ?
    defaults(options, DEFAULT_OPTIONS) : defaults({ workers: options }, DEFAULT_OPTIONS);
  let emitter = new EventEmitter();
  let running = true;
  let runUntil = Date.now() + opts.lifetime;

  listen();
  masterFn();
  fork();

  function listen() {
    cluster.on('exit', revive);
    emitter.once('shutdown', shutdown);
    process
      .on('SIGINT', () => proxySignal('SIGINT'))
      .on('SIGTERM', () => proxySignal('SIGTERM'));
  }

  function fork() {
    for (var i = 0; i < opts.workers; i++) {
      debug('forking new worker');
      cluster.fork();
    }
  }

  function proxySignal(signal) {
    debug('proxying signal %s', signal);
    emitter.emit('shutdown', signal);
  }

  function shutdown(signal) {
    running = false;
    debug('sending a message %s to all workers', signal);
    for (var id in cluster.workers) {
      cluster.workers[id].send(signal);
    }
    debug('%s sent to all workers, will hard exit in %s seconds', signal, opts.grace / 1e3);
    setTimeout(forceKill, opts.grace).unref();
  }

  function revive(worker, code, signal) {
    if (running && Date.now() < runUntil) {
      debug('forking new worker');
      cluster.fork();
    }
  }

  function forceKill() {
    debug('killing all workers with SIGKILL');
    for (var id in cluster.workers) {
      cluster.workers[id].kill('SIGKILL');
    }
    process.exit();
  }
};
