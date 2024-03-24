import { IDeviceData } from '@ha/IDeviceData';
import { Entity } from '@ha/base/Entity';
import { Dictionary } from '@utils/Dictionary';
import { intToBytes } from '@utils/intToBytes';
import { IController } from 'Common/IController';
import { ErgoWifiUser } from './options';
import { PayloadBuilder } from './requests/PayloadBuilder';
import { getAuthDetails } from './requests/getAuthDetails';
import { getConnection } from './requests/getConnection';
import { Device } from './requests/types/Device';

const loginPayload = (userId: number, authorize: string) => {
  return new PayloadBuilder(authorize.length + 10, 1)
    .addByte(3)
    .addInt(userId)
    .addShort(authorize.length)
    .addString(authorize)
    .addByte(0)
    .addShort(180)
    .build();
};

let lastMessageId = 0;
const getMessageId = () => {
  if (lastMessageId == 0 || lastMessageId >= 64000) {
    lastMessageId = (Math.trunc(Math.random() * 64000) % 63001) + 1000;
  }
  return (lastMessageId += 1) - 1;
};

const commandPayload = (id: number, command: number) => {
  const commandBytes = [0x4, 0x1, ...intToBytes(command).reverse()];
  const checksum = commandBytes.reduce((acc, curr) => (acc += curr), 0);
  const bytes = [0xaa, 0x3, 0x0, 0xf, 0x0, 0x12, 0x23, 0x34, 0x45, 0x0, 0x0, ...commandBytes, ~checksum, 0x40, 0x55];
  return new PayloadBuilder(bytes.length + 7, 7).addInt(id).addShort(getMessageId()).addByte(0).addBytes(bytes).build();
};

export class Controller implements IController<number> {
  entities: Dictionary<Entity> = {};

  constructor(public deviceData: IDeviceData, public device: Device, public user: ErgoWifiUser) {}

  writeCommand = async (data: number) => {
    const authDetails = await getAuthDetails(this.user);
    if (!authDetails) return;

    const { userId, authorize } = authDetails;
    const socket = await getConnection((socket) => socket.write(loginPayload(userId, authorize)));
    await socket.write(commandPayload(this.device.id, data));
  };
}
