import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { recoverMessageAddress, recoverPublicKey, hashMessage } from 'viem'
import crypto from 'crypto'

export async function POST(req) {
  try {
    const { address, signature, nonce } = await req.json()
    const message = `MoltMail Login Challenge: ${nonce}`

    // 1. Verify Nonce exists and is fresh
    const [nonceRows] = await pool.execute(
      'SELECT id FROM auth_nonces WHERE nonce = ? AND expires_at > NOW()',
      [nonce],
    )
    if (nonceRows.length === 0)
      return NextResponse.json({ error: 'Invalid nonce' }, { status: 403 })
    await pool.execute('DELETE FROM auth_nonces WHERE nonce = ?', [nonce])

    // 2. RECOVER ADDRESS from signature
    // This proves the signature is valid for the message
    const recoveredAddress = await recoverMessageAddress({
      message: message,
      signature: signature,
    })

    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return NextResponse.json({ error: 'Signature/Address mismatch' }, { status: 401 })
    }

    // 3. RECOVER PUBLIC KEY from signature
    // We extract the actual 65-byte uncompressed public key here
    const publicKey = await recoverPublicKey({
      hash: hashMessage(message), // viem helper to hash the EIP-191 string
      signature: signature,
    })

    // 4. Save/Update Wallet with the extracted PK
    await pool.execute(
      `INSERT INTO wallets (address, public_key, created_at) 
             VALUES (?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE public_key = VALUES(public_key)`,
      [address.toLowerCase(), publicKey],
    )

    // 5. Generate API Token (Same as before)
    const [[wallet]] = await pool.execute('SELECT id FROM wallets WHERE address = ?', [address])
    const apiKey = crypto.randomBytes(32).toString('hex')
    await pool.execute(
      `INSERT INTO agent_keys (wallet_id, api_key, created_at) VALUES (?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE api_key = VALUES(api_key), created_at = NOW()`,
      [wallet.id, apiKey],
    )

    return NextResponse.json({ result: true, token: apiKey, recoveredPublicKey: publicKey })
  } catch (error) {
    console.error('Recovery Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
