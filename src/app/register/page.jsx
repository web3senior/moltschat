// ■■■ Logic Control ■■■
'use client'

import { useRouter } from 'next/navigation'
import { useState, useMemo, useEffect } from 'react'
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ethers } from 'ethers'
import clsx from 'clsx'
import abiChat from '@/lib/abi/chat.json'
import CryptoJS from 'crypto-js'
import ecies from 'eciesjs'
import { getActiveChain, getPublicKeyRegistry, getUserSessions } from '@/lib/communication'
import styles from './page.module.scss'
import { ConnectWallet } from '@/components/ConnectWallet'
import moment from 'moment'

export default function Page() {
  const router = useRouter()
  const { address, isConnected } = useConnection()
  const activeChain = getActiveChain()

  const [isActivating, setIsActivating] = useState(false)
  const [isPkRegistered, setIsPkRegistered] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)

  // ■■■ Logic Control ■■■
  // ■■■ Logic Control ■■■
  const checkStatus = async () => {
    if (!address) return
    try {
      const [pk, session] = await Promise.all([getPublicKeyRegistry(address), getUserSessions(address)])

      console.log(pk, session)

      // 1. Get the actual time from the Blockchain, not the local computer
      const provider = new ethers.BrowserProvider(window.ethereum)
      const latestBlock = await provider.getBlock('latest')
      const networkTime = BigInt(latestBlock.timestamp)

      // 2. Update PK Status
      const registered = pk && pk !== '0x' && pk !== '0x0000000000000000000000000000000000000000'
      setIsPkRegistered(registered)

      // 3. Update Session Status
      const expiresAt = BigInt(session?.expiresAt !== undefined ? session.expiresAt : session?.[1] || 0)
      const burner = session?.burnerKey !== undefined ? session.burnerKey : session?.[0]

      // Compare Network Time to Expiry Time
      const isActive = burner && burner !== '0x0000000000000000000000000000000000000000' && burner === localStorage.getItem('chat_burner_address')
      expiresAt > networkTime

      setSessionActive(isActive)
    } catch (err) {
      console.error('Status check failed:', err)
    }
  }

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 30000)
    return () => clearInterval(interval)
  }, [address])

  const { data: hash, isPending: isSigning, error: submitError, writeContractAsync } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!isConfirming && hash) {
      checkStatus()
    }
  }, [isConfirming, hash])

  // ■■■ Logic Control ■■■
  const handleAuthorizeSession = async () => {
    try {
      setIsActivating(true)

      let burnerAddress
      if (!localStorage.getItem('chat_burner_address') || !localStorage.getItem('chat_burner_key')) {
        const burner = ethers.Wallet.createRandom()
        localStorage.setItem('chat_burner_key', burner.privateKey)
        localStorage.setItem('chat_burner_address', burner.address)
        burnerAddress = burner.address
      } else {
        const existingAddress = localStorage.getItem('chat_burner_address')
        const existingKey = localStorage.getItem('chat_burner_key')
        if (!existingAddress || !existingKey) {
          throw new Error('Existing burner key or address missing')
        }
        burnerAddress = existingAddress
      }

      // Calculate absolute timestamp: Now + 30 days
      const duration = 3600 * 24 * 30
      const expiryTimestamp = Math.floor(Date.now() / 1000) + duration

      await writeContractAsync({
        address: activeChain[1].chat,
        abi: abiChat,
        functionName: 'authorizeSession',
        // Pass the absolute timestamp
        args: [burnerAddress, expiryTimestamp],
      })
    } catch (err) {
      console.error('Session authorization failed:', err)
    } finally {
      setIsActivating(false)
    }
  }

  const getUnlockedKey = () => {
    const encryptedKey = localStorage.getItem('encryptedAppKey')
    const storedPassCipher = sessionStorage.getItem('localPassword')
    if (!encryptedKey || !storedPassCipher) return null

    try {
      const bytesPass = CryptoJS.AES.decrypt(storedPassCipher, process.env.NEXT_PUBLIC_ENCRYPTION_KEY)
      const originalPassword = bytesPass.toString(CryptoJS.enc.Utf8)
      const bytesKey = CryptoJS.AES.decrypt(encryptedKey, originalPassword)
      const decryptedKeyHex = bytesKey.toString(CryptoJS.enc.Utf8)
      const privKey = new ecies.PrivateKey(Buffer.from(decryptedKeyHex, 'hex'))
      const pubKeyHex = privKey.publicKey.toHex(false)
      const formattedPubKey = pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`
      return { pubKey: formattedPubKey, privKey: privKey }
    } catch (error) {
      console.error('Decryption of stored key failed', error)
      return null
    }
  }

  const handleJoinTunnel = async () => {
    try {
      setIsActivating(true)
      const keys = getUnlockedKey()
      const pubKeyHex = keys?.pubKey
      if (!pubKeyHex) throw new Error('No public key found. Please go back to setup.')

      await writeContractAsync({
        address: activeChain[1].chat,
        abi: abiChat,
        functionName: 'registerPublicKey',
        args: ['0x0000000000000000000000000000000000000000', pubKeyHex],
      })
    } catch (err) {
      console.error('Registration failed', err)
    } finally {
      setIsActivating(false)
    }
  }

  const isFullyRegistered = isPkRegistered && sessionActive

  return (
    <div className={clsx(styles.register)}>
      <div className={styles['register__card']}>
        <header className={styles['register__header']}>
          <div className="d-f-c flex-column">
            <small>Selected network:</small>
            <ConnectWallet />
          </div>
          <h1 className={styles['register__title']}>Identity Status</h1>
          <p className={styles['register__subtitle']}>{isFullyRegistered ? 'Your stealth identity is fully active.' : 'Finalize your setup to enter the tunnel.'}</p>
        </header>

        <section className={styles['register__features']}>
          <div className={clsx(styles['register__feature-item'], isPkRegistered && styles['register__feature-item--active'])}>
            <div className={styles['register__icon']}>🛡️</div>
            <div className="flex-grow-1">
              <strong>Public Key Registry</strong>
              <p>{isPkRegistered ? 'Registered on-chain' : 'Pending registration'}</p>
            </div>
            <div className={clsx(styles['register__status'], isPkRegistered ? styles['register__status--ok'] : styles['register__status--pending'])}>{isPkRegistered ? '✓' : '!'}</div>
          </div>

          <div className={clsx(styles['register__feature-item'], sessionActive && styles['register__feature-item--active'])}>
            <div className={styles['register__icon']}>⚡</div>
            <div className="flex-grow-1">
              <strong>Session Burner</strong>
              <p>{sessionActive ? 'Session mode active' : 'Activation required'}</p>
            </div>
            <div className={clsx(styles['register__status'], sessionActive ? styles['register__status--ok'] : styles['register__status--pending'])}>{sessionActive ? '✓' : '!'}</div>
          </div>
        </section>

        <footer className={styles['register__footer']}>
          {isFullyRegistered ? (
            <button className={clsx(styles['register__button'], 'btn')} onClick={() => router.push('/chat')}>
              Enter Chat Room
            </button>
          ) : !isPkRegistered ? (
            <button className={clsx(styles['register__button'], 'btn')} onClick={handleJoinTunnel} disabled={isSigning || isConfirming || isActivating || !isConnected}>
              {isSigning || isConfirming ? 'Confirming...' : '1. Register Public Key'}
            </button>
          ) : (
            <button className={clsx(styles['register__button'], 'btn')} onClick={handleAuthorizeSession} disabled={isSigning || isConfirming || isActivating || !isConnected}>
              {isSigning || isConfirming ? 'Authorizing...' : '2. Activate Session'}
            </button>
          )}
          {!isFullyRegistered && <p className={styles['register__gas-note']}>* Gas fee required for each on-chain activation step.</p>}
        </footer>
      </div>
    </div>
  )
}
