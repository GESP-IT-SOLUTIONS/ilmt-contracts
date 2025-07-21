# Bulk Vesting Deployment Guide

Acest ghid explică cum să adaugi o listă mare de utilizatori la contractul de vesting în batch-uri.

## 📋 Fișiere incluse

- `bulk-vesting-deployment.ts` - Script principal pentru deployment în batch-uri
- `run-bulk-vesting.ts` - Script complet pentru rularea deployment-ului
- `users-example.csv` - Exemplu de fișier CSV cu utilizatori
- `README-bulk-vesting.md` - Acest ghid

## 🚀 Cum să folosești scripturile

### 1. Metoda cu hardcoded users (pentru teste)

```bash
# Set contract address
export VESTING_CONTRACT_ADDRESS="0x..."

# Run with hardcoded users
npx hardhat run scripts/run-bulk-vesting.ts --network localhost
```

### 2. Metoda cu CSV file (pentru producție)

```bash
# Set environment variables
export VESTING_CONTRACT_ADDRESS="0x..."
export DEPLOYMENT_METHOD="csv"
export CSV_FILE_PATH="./scripts/your-users.csv"

# Optional: Configure vesting parameters
export CLIFF_DAYS="0"        # Default: 0 (no cliff)
export DURATION_DAYS="365"   # Default: 365 (1 year)
export SLICE_PERIOD_DAYS="1" # Default: 1 (daily)
export REVOCABLE="true"      # Default: true

# Run deployment
npx hardhat run scripts/run-bulk-vesting.ts --network localhost
```

### 3. Deployment automat (fără confirmări)

```bash
export AUTO_CONFIRM="true"
npx hardhat run scripts/run-bulk-vesting.ts --network localhost
```

## 📄 Format CSV

Fișierul CSV trebuie să aibă următoarele coloane:

| Coloană     | Obligatoriu | Descriere             | Exemplu     |
| ----------- | ----------- | --------------------- | ----------- |
| `address`   | ✅          | Adresa beneficiarului | `0x1111...` |
| `amount`    | ✅          | Suma în format ether  | `1000`      |
| `cliff`     | ❌          | Cliff în zile         | `30`        |
| `duration`  | ❌          | Durata în zile        | `365`       |
| `revocable` | ❌          | Dacă poate fi revocat | `true`      |

### Exemplu CSV:

```csv
address,amount,cliff,duration,revocable
0x1111111111111111111111111111111111111111,1000,0,365,true
0x2222222222222222222222222222222222222222,2000,30,365,true
0x3333333333333333333333333333333333333333,1500,0,180,false
```

## ⚙️ Configurarea parametrilor

### Pentru 1 an cu distribuție zilnică:

```bash
export CLIFF_DAYS="0"        # Fără cliff
export DURATION_DAYS="365"   # 1 an
export SLICE_PERIOD_DAYS="1" # Zilnic
```

### Pentru 2 ani cu distribuție săptămânală:

```bash
export CLIFF_DAYS="0"        # Fără cliff
export DURATION_DAYS="730"   # 2 ani
export SLICE_PERIOD_DAYS="7" # Săptămânal
```

### Pentru 6 luni cu cliff de 3 luni:

```bash
export CLIFF_DAYS="90"       # 3 luni cliff
export DURATION_DAYS="180"   # 6 luni total
export SLICE_PERIOD_DAYS="1" # Zilnic
```

## 🔧 Caracteristici avansate

### 1. Batch Processing

- Procesează automat în batch-uri de maxim 100 utilizatori
- Afișează progres în timp real
- Gestionează erorile individual pentru fiecare batch

### 2. Validări de siguranță

- Verifică balanța contractului înainte de deployment
- Validează adresele beneficiarilor
- Calculează total tokens necesari

### 3. Raportare detaliată

- Afișează progres pentru fiecare batch
- Raportează gas utilizat
- Evidențiază batch-urile eșuate

## 📊 Exemple de calcule

### Pentru 1000 utilizatori cu 1000 tokens fiecare:

- **Total tokens necesari**: 1,000,000 tokens
- **Număr batch-uri**: 10 (100 utilizatori per batch)
- **Timp estimat**: ~5-10 minute (cu 2s delay între batch-uri)

### Pentru distribuție zilnică timp de 1 an:

```javascript
// Parametri pentru 1 utilizator
{
    amount: "365000",           // 365,000 tokens total
    duration: 365,              // 365 zile
    slicePeriodDays: 1,         // 1 zi
    // = 1000 tokens per zi
}
```

## 🛠️ Troubleshooting

### Eroare: "Insufficient tokens in contract"

```bash
# Verifică balanța contractului
npx hardhat console --network localhost
> const contract = await ethers.getContractAt("ILMTVesting", "0x...")
> const balance = await contract.getWithdrawableAmount()
> console.log(ethers.formatEther(balance))
```

### Eroare: "Batch size exceeds limit"

Scriptul împarte automat în batch-uri de maxim 100. Această eroare nu ar trebui să apară.

### Eroare: "CSV file not found"

```bash
# Verifică calea fișierului
ls -la ./scripts/your-users.csv
```

## 🔒 Securitate

1. **Verifică întotdeauna lista de utilizatori** înainte de deployment
2. **Testează pe testnet** înainte de mainnet
3. **Verifică balanța contractului** înainte de deployment
4. **Salvează log-urile** pentru audit

## 📈 Monitoring

După deployment, poți verifica rezultatele:

```javascript
// Verifică numărul total de vesting schedules
await vestingContract.getVestingSchedulesCount();

// Verifică suma totală alocată
await vestingContract.getVestingSchedulesTotalAmount();

// Verifică schedule-urile pentru un beneficiar
await vestingContract.getAllVestingSchedulesForBeneficiary("0x...");
```

## 🎯 Best Practices

1. **Testează cu puțini utilizatori** înainte de deployment complet
2. **Folosește CSV pentru liste mari** (> 10 utilizatori)
3. **Verifică gas costs** pe testnet înainte de mainnet
4. **Păstrează backup-uri** ale fișierelor CSV
5. **Monitorizează deployment-ul** în timp real

## 📞 Suport

Pentru probleme sau întrebări, verifică:

1. Log-urile detaliате din script
2. Documentația contractului ILMTVesting
3. Testele de securitate din `test/ilmtVesting-security-audit.test.ts`
