import { AuthAdapter } from './AuthAdapter';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { env } from '../../config/env';
import NodeCache from 'node-cache';
import { usersRepo } from '../../db/users.repository';
import { credentialsRepo } from '../../db/credentials.repository';
import { v4 as uuidv4 } from 'uuid';

const challengeStore = new NodeCache({ stdTTL: 600 });

export class WebAuthnAuthAdapter implements AuthAdapter {
  async registerStart(handle: string, displayName: string, phone?: string) {
    const user = usersRepo.getByHandle(handle);
    if (user) throw { status: 409, message: 'Registration failed due to a conflict' };

    const userId = uuidv4();
    const options = await generateRegistrationOptions({
      rpName: env.WEBAUTHN_RP_NAME,
      rpID: env.WEBAUTHN_RP_ID,
      userID: new Uint8Array(Buffer.from(userId)),
      userName: handle,
      userDisplayName: displayName,
      attestationType: 'none',
    });

    challengeStore.set(`reg_${handle}`, { 
      challenge: options.challenge, 
      userId, 
      displayName,
      phone
    });

    return options;
  }

  async registerFinish(handle: string, response: any) {
    const session = challengeStore.get(`reg_${handle}`) as any;
    if (!session) throw { status: 400, message: 'Registration session expired or not found' };

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: session.challenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
      });
    } catch (e: any) {
      throw { status: 400, message: e.message };
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw { status: 400, message: 'Verification failed' };
    }

    const regInfo = verification.registrationInfo as any;
    const credentialID = regInfo.credentialID || regInfo.credential?.id || regInfo.id;
    const credentialPublicKey = regInfo.credentialPublicKey || regInfo.credential?.publicKey || regInfo.publicKey;
    const counter = regInfo.counter ?? regInfo.credential?.counter ?? 0;

    const user = usersRepo.create({
      handle,
      display_name: session.displayName,
      phone: session.phone,
    });

    credentialsRepo.create({
      user_id: user.id,
      credential_id: typeof credentialID === 'string' ? credentialID : Buffer.from(credentialID).toString('base64url'),
      public_key: typeof credentialPublicKey === 'string' ? credentialPublicKey : Buffer.from(credentialPublicKey).toString('base64url'),
      counter,
      transports: null,
    });

    challengeStore.del(`reg_${handle}`);
    return user;
  }

  async loginStart(handle: string) {
    const user = usersRepo.getByHandle(handle);
    let options;
    if (!user) {
      options = await generateAuthenticationOptions({
        rpID: env.WEBAUTHN_RP_ID,
        userVerification: 'preferred',
      });
    } else {
      const userCreds = credentialsRepo.getByUserId(user.id);
      options = await generateAuthenticationOptions({
        rpID: env.WEBAUTHN_RP_ID,
        allowCredentials: userCreds.map(c => ({
          id: c.credential_id,
          transports: c.transports ? JSON.parse(c.transports) : undefined,
        })),
        userVerification: 'preferred',
      });
    }

    challengeStore.set(`auth_${handle}`, options.challenge);
    return options;
  }

  async loginFinish(handle: string, response: any) {
    const expectedChallenge = challengeStore.get(`auth_${handle}`) as string;
    if (!expectedChallenge) throw { status: 400, message: 'Login session expired or not found' };

    const user = usersRepo.getByHandle(handle);
    if (!user) throw { status: 404, message: 'User not found' };

    const cred = credentialsRepo.getByCredentialId(response.id);
    if (!cred || cred.user_id !== user.id) throw { status: 400, message: 'Invalid credential' };

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: {
          id: cred.credential_id,
          publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64url')),
          counter: cred.counter,
        } as any,
      });
    } catch (e: any) {
      throw { status: 400, message: e.message };
    }

    if (!verification.verified) throw { status: 400, message: 'Verification failed' };

    challengeStore.del(`auth_${handle}`);
    return user;
  }
}
