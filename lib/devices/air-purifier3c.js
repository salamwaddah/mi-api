'use strict';

const { AirPurifier } = require('abstract-things/climate');
const MiioApi = require('../device');

const Power = require('./capabilities/power');
const Mode = require('./capabilities/mode');
const LEDBrightness = require('./capabilities/changeable-led-brightness');
const Buzzer = require('./capabilities/buzzer');
const { AQI } = require('./capabilities/sensor');

/**
 * Abstraction over a Mi Air Purifier.
 *
 * Air Purifiers have a mode that indicates if is on or not. Changing the mode
 * to `idle` will power off the device, all other modes will power on the
 * device.
 */
module.exports = class extends (
  AirPurifier.with(MiioApi, Power, Mode, AQI, LEDBrightness, Buzzer)
) {
  get serviceMapping() {
    return {
      power: { siid: 2, piid: 1 },
      mode: {
        siid: 2,
        piid: 4,
        mapping: (mode) => {
          switch (mode) {
            case 'auto':
              return 0;
            case 'sleep':
              return 1;
            case 'favorite':
              return 2;
            case 'idle:':
              return 3;
            default:
              return 0;
          }
        },
      },
      aqi: { siid: 3, piid: 4 },
      favorite_rpm: {
        siid: 9,
        piid: 3,
      },
      filter_life_remaining: { siid: 4, piid: 1 },
      filter_hours_used: { siid: 4, piid: 3 },
      led_brightness_level: { siid: 7, piid: 2 },
      buzzer: { siid: 6, piid: 1 },
    };
  }

  getServiceProperty(prop) {
    return {
      did: String(this.handle.api.id),
      siid: this.serviceMapping[prop].siid,
      piid: this.serviceMapping[prop].piid,
    };
  }

  static get type() {
    return 'miio:air-purifier';
  }

  loadProperties(props) {
    // Rewrite property names to device internal ones
    props = props.map((key) => this._reversePropertyDefinitions[key] || key);

    const propObjects = props
      .filter((prop) => this.serviceMapping[prop])
      .map(this.getServiceProperty.bind(this));

    return this.call('get_properties', propObjects).then((result) => {
      const obj = {};
      for (let i = 0; i < result.length; i++) {
        this._pushProperty(obj, props[i], result[i].value);
      }
      return obj;
    });
  }

  constructor(options) {
    super(options);

    // Define the power property
    this.defineProperty('power');

    // Set the mode property and supported modes
    this.defineProperty('mode', {
      mapper: (v) => {
        switch (v) {
          case 0:
            return 'auto';
          case 1:
            return 'silent';
          case 2:
            return 'favorite';
          case 3:
            return 'idle';
        }
      },
    });
    this.updateModes(['idle', 'auto', 'silent', 'favorite']);

    // Sensor value used for AQI (PM2.5) capability
    this.defineProperty('aqi');

    // The favorite level
    this.defineProperty('favorite_rpm', {
      name: 'favoriteRPM',
    });

    // Info about usage
    this.defineProperty('filter_life_remaining', {
      name: 'filterLifeRemaining',
    });
    this.defineProperty('filter_hours_used', {
      name: 'filterHoursUsed',
    });

    this.defineProperty('led_brightness_level', {
      name: 'ledBrightness',
      mapper: (v) => {
        switch (v) {
          case 0:
            return 'bright';
          case 1:
            return 'dim';
          case 2:
            return 'off';
          default:
            return 'unknown';
        }
      },
    });

    // Buzzer and beeping
    this.defineProperty('buzzer');
  }

  changePower(power) {
    const attributes = [];

    if (!power) {
      // change mode to idle when turning off
      attributes.push(
        Object.assign(this.getServiceProperty('mode'), { value: 3 })
      );
    }

    attributes.push(
      Object.assign({ value: power }, this.getServiceProperty('power'))
    );

    return this.call('set_properties', attributes, {
      refresh: ['power', 'mode'],
      refreshDelay: 200,
    });
  }

  /**
   * Perform a mode change as requested by `mode(string)` or
   * `setMode(string)`.
   */
  changeMode(mode) {
    const realMode = this.serviceMapping['mode'].mapping(mode);

    return this.call(
      'set_properties',
      [Object.assign({ value: realMode }, this.getServiceProperty('mode'))],
      {
        refresh: ['power', 'mode'],
        refreshDelay: 200,
      }
    )
      .then(MiioApi.checkOk)
      .catch((err) => {
        throw err.code === -5001
          ? new Error('Mode `' + mode + '` not supported')
          : err;
      });
  }

  /**
   * Get the favorite level used when the mode is `favorite`. Between 0 and 16.
   */
  favoriteRPM(level = undefined) {
    if (typeof level === 'undefined') {
      return Promise.resolve(this.property('favoriteRPM'));
    }

    return this.setFavoriteRPM(level);
  }

  /**
   * Set the favorite level used when the mode is `favorite`
   * min value: 300
   * max value: 2200
   */
  setFavoriteRPM(value) {
    return this.call('set_properties', [
      Object.assign({ value }, this.getServiceProperty('favorite_rpm')),
    ]).then(() => null);
  }

  /**
   * Set the LED brightness to either `bright`, `dim` or `off`.
   */
  changeLEDBrightness(level) {
    switch (level) {
      case 'bright':
        level = 0;
        break;
      case 'dim':
        level = 1;
        break;
      case 'off':
        level = 2;
        break;
      default:
        return Promise.reject(new Error('Invalid LED brigthness: ' + level));
    }

    return this.call('set_properties', [
      Object.assign(
        { value: level },
        this.getServiceProperty('led_brightness_level')
      ),
    ]).then(() => null);
  }
};
