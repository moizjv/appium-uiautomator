import events from 'events';
import { SubProcess } from 'teen_process';
import log from './logger';

class UiAutomator extends events.EventEmitter {
  constructor (adb) {
    if (!adb) {
      log.errorAndThrow("adb is required to instantiate UiAutomator");
    }
    super();
    this.adb = adb;
    this.tempPath = "/data/local/tmp/";
  }

  async start (uiAutomatorBinaryPath, className, startDetector, ...extraParams) {
    let processIsAlive;
    try {
      this.changeState(UiAutomator.STATE_STARTING);
      log.debug("Starting UiAutomator");
      log.debug("Parsing uiautomator jar");
      // expecting a path like /ads/ads/foo.jar or \asd\asd\foo.jar
      let jarName = this.parseJarNameFromPath(uiAutomatorBinaryPath);
      await this.adb.push(uiAutomatorBinaryPath, this.tempPath);
      // killing any uiautomator existing processes
      await this.killUiAutomatorOnDevice();
      let args = ["shell", "uiautomator", "runtest", jarName, "-c", className];
      args.push(...extraParams);
      const adbPath = this.adb.getAdbPath();
      log.debug(`Executing command ${adbPath} ${args}`);
      this.proc = new SubProcess(adbPath, args);
      // handle out-of-bound exit by simply emitting a stopped state
      this.proc.on('exit', (code, signal) => {
        processIsAlive = false;
        // cleanup
        if (this.state !== UiAutomator.STATE_STOPPED &&
            this.state !== UiAutomator.STATE_STOPPING) {
          let msg = `UiAutomator exited unexpectedly with code ${code}, ` +
                    `signal ${signal}`;
          log.error(msg);
        } else if (this.state === UiAutomator.STATE_STOPPING) {
          log.debug("UiAutomator shut down normally");
        }
        this.changeState(UiAutomator.STATE_STOPPED);
      });
      await this.proc.start(startDetector);
      processIsAlive = true;
      this.changeState(UiAutomator.STATE_ONLINE);
      return this.proc;
    } catch (e) {
      this.emit(UiAutomator.EVENT_ERROR, e);
      if (processIsAlive) {
        await this.killUiAutomatorOnDevice();
        await this.proc.stop();
      }
      log.errorAndThrow(e);
    }
  }

  async shutdown () {
    this.changeState(UiAutomator.STATE_STOPPING);
    await this.proc.stop();
    await this.killUiAutomatorOnDevice();
    this.changeState(UiAutomator.STATE_STOPPED);
  }

  parseJarNameFromPath (binaryPath) {
    let reTest = /.*(\/|\\)(.*\.jar)/.exec(binaryPath);
    if (!reTest) {
      throw new Error(`Unable to parse jar name from ${binaryPath}`);
    }
    return reTest[2];
  }

  changeState (state) {
    this.state = state;
    this.emit(UiAutomator.EVENT_CHANGED, {state});
  }

  async killUiAutomatorOnDevice() {
    try {
      await this.adb.killProcessesByName('uiautomator');
    } catch (e) {
      log.warn(`Error while killing uiAutomator: ${e}`);
    }
  }

}

UiAutomator.EVENT_ERROR = 'uiautomator_error';
UiAutomator.EVENT_CHANGED = 'stateChanged';
UiAutomator.STATE_STOPPED = 'stopped';
UiAutomator.STATE_STARTING = 'starting';
UiAutomator.STATE_ONLINE = 'online';
UiAutomator.STATE_STOPPING = 'stopping';

export default UiAutomator;
