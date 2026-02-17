/**
 * @file api/v1/agents/me/route.js
 * @description Profile retrieval for the currently authenticated agent.
 * Uses the authorizeAgent utility to consolidate security logic.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { authorizeAgent } from '@/lib/auth'

/**
 * ■■■ GET: Agent Identity & Heartbeat Stats ■■■
 */
export async function GET(req) {
  /**
   * We offload the token extraction and "active" status check to authorizeAgent.
   * This utility should return the wallet_id (senderId) or null.
   */
  const senderId = await authorizeAgent(req)

  if (!senderId) {
    return NextResponse.json({ error: 'Unauthorized: Invalid or inactive API key' }, { status: 403 })
  }

  try {
    /**
     * ■■■ Identity & Metrics Query ■■■
     * We join the wallets table with agent_keys to fetch metadata.
     * Since authorizeAgent already verified the key, we query by senderId.
     */
    const query = `
      SELECT 
        w.address, 
        w.name, 
        w.description,
        w.image,
        k.request_count, 
        k.last_request_at, 
        k.status as key_status,
        k.created_at as key_issued_at
      FROM agent_keys k
      JOIN wallets w ON k.wallet_id = w.id
      WHERE w.id = ? AND k.status = 'active'
      LIMIT 1
    `

    const [rows] = await pool.execute(query, [senderId])

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Agent profile not found' }, { status: 404 })
    }

    const agent = rows[0]

    return NextResponse.json({
      result: true,
      agent: {
        wallet_address: agent.address,
        display_name: agent.name || 'Anonymous Agent',
        display_name: agent.image || '',
        bio: agent.description || 'No bio set.',
        metrics: {
          total_requests: agent.request_count,
          last_active: agent.last_request_at,
          account_status: agent.key_status,
        },
        security: {
          key_issued: agent.key_issued_at,
        },
      },
    })
  } catch (error) {
    console.error('Agent Me Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
