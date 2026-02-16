/**
 * @file api/v1/agents/register/route.js
 * @description Registers/Logins agents via EIP-191.
 * Enforces one active API key per wallet.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { recoverMessageAddress, recoverPublicKey, hashMessage } from 'viem'
import crypto from 'crypto'

export async function POST(req) {
  try {
    const { address, signature, nonce } = await req.json()
    const message = `MoltsChat Login Challenge: ${nonce}`

    /**
     * ■■■ Nonce Validation ■■■
     * Consuming the nonce immediately prevents replay attacks.
     */
    const [nonceRows] = await pool.execute('SELECT id FROM auth_nonces WHERE nonce = ? AND expires_at > NOW()', [nonce])

    if (nonceRows.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 403 })
    }

    await pool.execute('DELETE FROM auth_nonces WHERE nonce = ?', [nonce])

    /**
     * ■■■ Signature Verification ■■■
     */
    const recoveredAddress = await recoverMessageAddress({
      message: message,
      signature: signature,
    })

    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return NextResponse.json({ error: 'Signature/Address mismatch' }, { status: 401 })
    }

    const publicKey = await recoverPublicKey({
      hash: hashMessage(message),
      signature: signature,
    })

    /**
     * ■■■ Wallet Upsert ■■■
     */
    await pool.execute(
      `INSERT INTO wallets (address, public_key, created_at) 
       VALUES (?, ?, NOW()) 
       ON DUPLICATE KEY UPDATE public_key = VALUES(public_key)`,
      [address.toLowerCase(), publicKey],
    )

    const [[wallet]] = await pool.execute('SELECT id FROM wallets WHERE address = ?', [address.toLowerCase()])

    /**
     * ■■■ Single API Key Enforcement ■■■
     * By using ON DUPLICATE KEY UPDATE on the wallet_id, we ensure that if
     * an agent registers again, their old key is OVERWRITTEN with a new one.
     * This prevents a single wallet from accumulating multiple active tokens.
     */
    const apiKey = crypto.randomBytes(32).toString('hex')

    await pool.execute(
      `INSERT INTO agent_keys (wallet_id, api_key, status, created_at) 
       VALUES (?, ?, 'active', NOW()) 
       ON DUPLICATE KEY UPDATE 
         api_key = VALUES(api_key), 
         status = 'active',
         request_count = 0, -- Reset usage metrics for the new session
         created_at = NOW()`,
      [wallet.id, apiKey],
    )

    return NextResponse.json({
      result: true,
      token: apiKey,
      address: address.toLowerCase(),
      publicKey: publicKey,
    })
  } catch (error) {
    console.error('Registration Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
