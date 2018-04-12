import { BaseLogger as PinoLogger } from 'pino';
import pino = require('pino');
import flatstr = require('flatstr');
export {
  LogEntry,
  ErrorContext,
  LogEntryHttpRequest,
  LogEntryOperation,
  LogEntrySourceLocation,
} from './constants';
import { LogEntry } from './constants';
import path = require('path');

export interface LogFn {
  (msg: string, ...args: any[]): void;
  (obj: LogEntry, msg: string, ...args: any[]): void;
  (obj: LogEntry, err: Error): void;
  (objOrMsg: LogEntry | string): void;
}

/**
 * Service identification, for error reporting.
 *
 * This is appended to error reports, and can be useful to identify the
 * service on start-up and other contexts.
 */
export interface ServiceContext {
  service: string;
  version: string;
}

export interface BaseLogger extends PinoLogger {
  serviceContext: ServiceContext;
  emergency: LogFn;
  alert: LogFn;
  fatal: LogFn;
  error: LogFn;
  warn: LogFn;
  notice: LogFn;
  info: LogFn;
  debug: LogFn;
  trace: LogFn;
}

export interface LoggerOptions extends pino.LoggerOptions {
  base?: object;
  serviceContext?: ServiceContext;
}

export type Logger = BaseLogger & { [key: string]: LogFn };

const severity: any = {
  10: 'DEBUG',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARNING',
  50: 'ERROR',
  60: 'CRITICAL',
};

function addLevel(this: any, name: string, lvl: number) {
  // all we do is fix the lscache
  Object.getPrototypeOf(this).addLevel(name, lvl);
  (this as any)._lscache[lvl] = flatstr(`{"severity":"${name.toUpperCase()}"`);
}

// Need to override this to change how errors are serialized
// Copy-paste
function asJson(
  this: any,
  obj: any,
  msg: string | undefined | Error,
  num: number,
) {
  // to catch both null and undefined
  var hasObj = obj !== undefined && obj !== null;
  var objError = hasObj && obj instanceof Error;
  var msgErr = msg instanceof Error;
  var err = undefined;
  if (objError) {
    err = obj;
  } else if (msgErr) {
    err = msg;
  }
  var msgIsStackTrace = msgErr || (!msg && objError);

  msg = msgIsStackTrace ? err.stack : msg || undefined;
  var data = this._lscache[num] + this.time();
  if (msg !== undefined) {
    // JSON.stringify is safe here
    data += this.messageKeyString + JSON.stringify('' + msg);
  }
  // we need the child bindings added to the output first so that logged
  // objects can take precedence when JSON.parse-ing the resulting log line
  data = data + this.chindings;
  var value;
  if (hasObj) {
    var notHasOwnProperty = obj.hasOwnProperty === undefined;
    if (err) {
      // CHANGE: Only print stack trace if it was not the message
      data += ',"type":"' + err.constructor.name + '"';
      if (!msgIsStackTrace) {
        data += ',"stack":' + this.stringify(err.stack);
      }

      if (this.serviceContext && (msgIsStackTrace || obj.reportLocation)) {
        data += ',"serviceContext":' + this.stringify(this.serviceContext);
      }

      if (!objError) {
        const { name, ...rest } = err;
        obj = { ...obj, ...rest };
      }
    }
    for (var key in obj) {
      if (objError && key === 'name') {
        continue;
      }

      value = obj[key];
      if (
        (notHasOwnProperty || obj.hasOwnProperty(key)) &&
        value !== undefined
      ) {
        value = this.stringify(value);
        if (value !== undefined) {
          data += ',"' + key + '":' + value;
        }
      }
    }
  }
  return data + this.end;
}

export function plack(options?: LoggerOptions): Logger {
  options = options || {};

  const instance = pino({
    // dont include hostname, pid et cetera
    base: options.base || {},
    messageKey: 'message',
    serializers: {
      // err property is not serialized because it is special cased
      err: () => undefined,
      ...options.serializers,
    },
    ...options,
  } as any);

  // For error reporting
  (instance as any).serviceContext =
    options.serviceContext || defaultServiceContext();

  // dont include log version specifier
  (instance as any).end = '}\n';

  // override lscache to output severity and not level
  Object.defineProperty(instance, '_lscache', {
    value: Object.keys(severity).reduce(
      (o, k) => {
        o[k] = flatstr(`{"severity":"${severity[k]}"`);
        return o;
      },
      {} as any,
    ),
  });

  Object.defineProperty(instance, 'addLevel', {
    value: addLevel,
  });

  Object.defineProperty(instance, 'asJson', {
    value: asJson,
  });

  instance.addLevel('notice', 35);
  instance.addLevel('alert', 70);
  instance.addLevel('emergency', 80);
  return (instance as any) as Logger;
}

export function defaultServiceContext(service?: string): ServiceContext {
  if (!service) {
    try {
      const pkg = require(path.resolve(process.cwd(), 'package.json'));
      service = path.basename(pkg.name);
    } catch (err) {
      err.message = `Cannot determine service context name: ${err.message}`;
      throw err;
    }
  }

  return {
    service,
    version: process.env.VERSION || 'latest',
  };
}

export default plack;
