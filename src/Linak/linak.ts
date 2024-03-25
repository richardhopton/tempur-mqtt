import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { Dictionary } from '@utils/Dictionary';
import { buildDictionary } from '@utils/buildDictionary';
import { logInfo } from '@utils/logger';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { buildMQTTDeviceData } from 'Common/buildMQTTDeviceData';
import { IESPConnection } from 'ESPHome/IESPConnection';
import { Controller } from './Controller';
import { BedPositionSensor } from './entities/BedPositionSensor';
import { getDevices } from './options';
import { setupLightEntities } from './setupLightsEntities';
import { setupMassageButtons } from './setupMassageButtons';
import { setupPresetButtons } from './setupPresetButtons';

export const linak = async (mqtt: IMQTTConnection, esphome: IESPConnection) => {
  const devices = getDevices();
  if (!devices.length) return logInfo('[Linak] No devices configured');

  const devicesMap = buildDictionary(devices, (device) => ({ key: device.name, value: device }));
  const bleDevices = await esphome.getBLEDevices(Object.keys(devicesMap));
  for (const bleDevice of bleDevices) {
    const { name, address, connect, disconnect, getServices } = bleDevice;
    const { hasMassage, ...device } = devicesMap[name];
    const deviceData = buildMQTTDeviceData({ ...device, address }, 'Linak');
    await connect();
    const services = await getServices();

    const service = services.find((s) => s.uuid === '99fa0001-338a-1024-8a49-009c0215f78a');
    if (!service) {
      logInfo('[Linak] Could not find expected services for device:', name);
      await disconnect();
      continue;
    }

    const characteristic = service.characteristicsList.find((c) => c.uuid === '99fa0002-338a-1024-8a49-009c0215f78a');
    if (!characteristic) {
      logInfo('[Linak] Could not find expected characteristic for device:', name);
      await disconnect();
      continue;
    }

    const outputHandles: Dictionary<number> = {};
    const outputService = services.find((s) => s.uuid === '99fa0020-338a-1024-8a49-009c0215f78a');
    if (outputService) {
      const backCharacteristic = outputService.characteristicsList.find(
        (c) => c.uuid === '99fa0028-338a-1024-8a49-009c0215f78a'
      );
      if (backCharacteristic) outputHandles['back'] = backCharacteristic.handle;

      const legCharacteristic = outputService.characteristicsList.find(
        (c) => c.uuid === '99fa0027-338a-1024-8a49-009c0215f78a'
      );
      if (legCharacteristic) outputHandles['leg'] = legCharacteristic.handle;

      // const { motorCount = 2 } = device;
      // if (motorCount > 2) {
      //   const headCharacteristic = outputService.characteristicsList.find(
      //     (c) => c.uuid === '99fa0026-338a-1024-8a49-009c0215f78a'
      //   );
      //   if (headCharacteristic) outputHandles['head'] = headCharacteristic.handle;
      // }
      // if (motorCount > 3) {
      //   const feetCharacteristic = outputService.characteristicsList.find(
      //     (c) => c.uuid === '99fa0025-338a-1024-8a49-009c0215f78a'
      //   );
      //   if (feetCharacteristic) outputHandles['feet'] = feetCharacteristic.handle;
      // }
    }
    const isAdvanced = !!outputService;
    const controller = new Controller(deviceData, bleDevice, device, isAdvanced, characteristic.handle, outputHandles);
    logInfo('[Linak] Setting up entities for device:', name);
    setupLightEntities(mqtt, controller);

    if (hasMassage) setupMassageButtons(mqtt, controller);

    if (!isAdvanced) continue;
    setupPresetButtons(mqtt, controller);

    const mapPositionData = (data: Uint8Array) => (data[1] << 8) | data[0];
    if (outputHandles.back) {
      const backPositionSensor = new BedPositionSensor(mqtt, deviceData, buildEntityConfig('AngleBack'), 820, 68);
      controller.on('back', (data) => backPositionSensor.setPosition(mapPositionData(data)));
    }

    if (outputHandles.leg) {
      const legPositionSensor = new BedPositionSensor(mqtt, deviceData, buildEntityConfig('AngleLeg'), 548, 45);
      controller.on('leg', (data) => legPositionSensor.setPosition(mapPositionData(data)));
    }
  }
};
