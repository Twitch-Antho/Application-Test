<?php
declare(strict_types=1);

session_set_cookie_params([
    'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Lax',
]);
session_start();

const DISCORD_API = 'https://discord.com/api/v10';
$discordClientId = getenv('DISCORD_CLIENT_ID') ?: '';
$discordClientSecret = getenv('DISCORD_CLIENT_SECRET') ?: '';
$discordRedirectUri = getenv('DISCORD_REDIRECT_URI') ?: '';
$discordGuildId = getenv('DISCORD_GUILD_ID') ?: '';
$discordBotToken = getenv('DISCORD_BOT_TOKEN') ?: '';
$supportRoleIds = array_values(array_filter(array_map('trim', explode(',', getenv('DISCORD_SUPPORT_ROLE_IDS') ?: ''))));
$oauthReady = $discordClientId !== '' && $discordClientSecret !== '' && $discordRedirectUri !== '';
$supportCheckReady = $discordGuildId !== '' && $discordBotToken !== '' && $supportRoleIds !== [];
$databaseError = null;

try {
    $dataDirectory = __DIR__ . DIRECTORY_SEPARATOR . 'data';
    if (!is_dir($dataDirectory) && !mkdir($dataDirectory, 0750, true) && !is_dir($dataDirectory)) {
        throw new RuntimeException('Le dossier de données ne peut pas être créé.');
    }
    $database = new PDO('sqlite:' . $dataDirectory . DIRECTORY_SEPARATOR . 'tickets.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $database->exec('CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT NOT NULL, username TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT "open", assigned_to TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
} catch (Throwable $exception) {
    $database = null;
    $databaseError = $exception->getMessage();
}

if (!isset($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function redirectTo(string $location): never
{
    header('Location: ' . $location);
    exit;
}

function discordRequest(string $method, string $url, ?array $payload = null, ?string $token = null): array
{
    $curl = curl_init(DISCORD_API . $url);
    $headers = ['Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'];
    if ($token !== null) {
        $headers[] = 'Authorization: Bot ' . $token;
    }
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 10,
    ]);
    if ($payload !== null) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, http_build_query($payload));
    }
    $response = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    return ['status' => $status, 'body' => is_string($response) ? json_decode($response, true) : null];
}

if (($_GET['action'] ?? '') === 'login') {
    if (!$oauthReady) {
        redirectTo('ticket.php?error=oauth_config');
    }
    $_SESSION['oauth_state'] = bin2hex(random_bytes(24));
    $query = http_build_query(['client_id' => $discordClientId, 'redirect_uri' => $discordRedirectUri, 'response_type' => 'code', 'scope' => 'identify', 'state' => $_SESSION['oauth_state']]);
    redirectTo('https://discord.com/oauth2/authorize?' . $query);
}

if (($_GET['action'] ?? '') === 'callback') {
    $stateValid = isset($_GET['state'], $_SESSION['oauth_state']) && hash_equals($_SESSION['oauth_state'], (string) $_GET['state']);
    if (!$stateValid || !$oauthReady || empty($_GET['code'])) {
        redirectTo('ticket.php?error=oauth');
    }
    $tokenResponse = discordRequest('POST', '/oauth2/token', ['client_id' => $discordClientId, 'client_secret' => $discordClientSecret, 'grant_type' => 'authorization_code', 'code' => (string) $_GET['code'], 'redirect_uri' => $discordRedirectUri]);
    $accessToken = $tokenResponse['body']['access_token'] ?? null;
    if (!$accessToken) {
        redirectTo('ticket.php?error=oauth');
    }
    $userResponse = discordRequest('GET', '/users/@me', null, $accessToken);
    if (($userResponse['status'] ?? 0) !== 200 || empty($userResponse['body']['id'])) {
        redirectTo('ticket.php?error=oauth');
    }
    $_SESSION['discord_user'] = ['id' => (string) $userResponse['body']['id'], 'username' => (string) ($userResponse['body']['global_name'] ?: $userResponse['body']['username'])];
    unset($_SESSION['oauth_state']);
    redirectTo('ticket.php?success=connected');
}

if (($_GET['action'] ?? '') === 'logout') {
    $_SESSION = [];
    session_destroy();
    redirectTo('ticket.php');
}

$user = $_SESSION['discord_user'] ?? null;
$isSupport = false;
if ($user && $supportCheckReady) {
    $memberResponse = discordRequest('GET', '/guilds/' . rawurlencode($discordGuildId) . '/members/' . rawurlencode($user['id']), null, $discordBotToken);
    $memberRoles = $memberResponse['body']['roles'] ?? [];
    $isSupport = count(array_intersect($supportRoleIds, $memberRoles)) > 0;
}

$message = '';
$messageType = 'success';
if (isset($_GET['error'])) {
    $messageType = 'error';
    $message = match ($_GET['error']) { 'oauth_config' => 'La connexion Discord n’est pas encore configurée sur le serveur.', 'oauth' => 'La connexion Discord a échoué. Réessayez.', default => 'Une erreur est survenue.' };
}
if (isset($_GET['success']) && $_GET['success'] === 'connected') {
    $message = 'Connexion Discord réussie.';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $csrfValid = isset($_POST['csrf'], $_SESSION['csrf']) && hash_equals($_SESSION['csrf'], (string) $_POST['csrf']);
    if (!$csrfValid) {
        $message = 'La session a expiré. Rechargez la page et réessayez.';
        $messageType = 'error';
    } elseif (!$user) {
        $message = 'Connectez-vous avec Discord avant de continuer.';
        $messageType = 'error';
    } elseif (!$database) {
        $message = 'La base de données des tickets est indisponible.';
        $messageType = 'error';
    } elseif (($_POST['action'] ?? '') === 'create_ticket') {
        $subject = trim((string) ($_POST['subject'] ?? ''));
        $ticketMessage = trim((string) ($_POST['message'] ?? ''));
        if ($subject === '' || $ticketMessage === '' || strlen($subject) > 120 || strlen($ticketMessage) > 4000) {
            $message = 'Renseignez un sujet et un message valides.';
            $messageType = 'error';
        } else {
            $statement = $database->prepare('INSERT INTO tickets (discord_id, username, subject, message) VALUES (:discord_id, :username, :subject, :message)');
            $statement->execute(['discord_id' => $user['id'], 'username' => $user['username'], 'subject' => $subject, 'message' => $ticketMessage]);
            $message = 'Votre ticket a été créé. Le support va revenir vers vous.';
        }
    } elseif ($isSupport && ($_POST['action'] ?? '') === 'update_ticket') {
        $ticketId = filter_input(INPUT_POST, 'ticket_id', FILTER_VALIDATE_INT);
        $status = in_array($_POST['status'] ?? '', ['open', 'closed'], true) ? $_POST['status'] : 'open';
        if ($ticketId) {
            $statement = $database->prepare('UPDATE tickets SET status = :status, assigned_to = :assigned_to, updated_at = CURRENT_TIMESTAMP WHERE id = :id');
            $statement->execute(['status' => $status, 'assigned_to' => $user['username'], 'id' => $ticketId]);
            $message = 'Le ticket a été mis à jour.';
        }
    }
}

$myTickets = [];
$allTickets = [];
if ($database && $user) {
    $statement = $database->prepare('SELECT * FROM tickets WHERE discord_id = :discord_id ORDER BY created_at DESC');
    $statement->execute(['discord_id' => $user['id']]);
    $myTickets = $statement->fetchAll(PDO::FETCH_ASSOC);
    if ($isSupport) {
        $allTickets = $database->query('SELECT * FROM tickets ORDER BY CASE status WHEN "open" THEN 0 ELSE 1 END, created_at DESC')->fetchAll(PDO::FETCH_ASSOC);
    }
}
?>
<!doctype html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Support Team Royale : créez et suivez vos tickets avec votre compte Discord.">
    <title>Support — Team Royale</title>
    <link rel="stylesheet" href="ticket.css">
</head>
<body>
    <header class="ticket-header">
        <a class="ticket-logo" href="acceuil.html"><span>TR</span><strong>Team<br>Royale</strong></a>
        <a class="back-link" href="acceuil.html">← Retour à l'accueil</a>
        <?php if ($user): ?><div class="account"><span>Connecté : <?= escape($user['username']) ?></span><a href="ticket.php?action=logout">Déconnexion</a></div><?php endif; ?>
    </header>
    <main class="ticket-main">
        <section class="ticket-hero"><p class="eyebrow">Support / <?= $isSupport ? 'Espace équipe' : 'Espace membre' ?></p><h1>On vous<br><i>écoute.</i></h1><p>Créez un ticket privé pour contacter Team Royale. Votre demande reste liée à votre compte Discord et peut être suivie ici.</p></section>
        <?php if ($message): ?><div class="notice <?= escape($messageType) ?>"><?= escape($message) ?></div><?php endif; ?>
        <?php if (!$user): ?>
            <section class="login-card"><div><p class="section-label">01 / Identification</p><h2>Connectez-vous<br>avec Discord.</h2><p>Votre compte Discord nous permet de vous identifier sans créer de nouveau mot de passe.</p></div><a class="discord-button" href="ticket.php?action=login">Connexion Discord <span>↗</span></a><?php if (!$oauthReady): ?><small>Configuration OAuth2 requise : DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET et DISCORD_REDIRECT_URI.</small><?php endif; ?></section>
        <?php else: ?>
            <section class="create-section"><div class="section-intro"><p class="section-label">01 / Nouveau ticket</p><h2>Quel est<br>le sujet ?</h2><p>Décrivez votre demande avec le plus de contexte possible. Un membre du support vous répondra depuis cet espace.</p></div><form class="ticket-form" method="post"><input type="hidden" name="csrf" value="<?= escape($_SESSION['csrf']) ?>"><input type="hidden" name="action" value="create_ticket"><label for="subject">Sujet</label><input id="subject" name="subject" maxlength="120" required placeholder="Ex. Question sur un événement"><label for="message">Message</label><textarea id="message" name="message" maxlength="4000" required placeholder="Expliquez-nous votre demande..."></textarea><button class="submit-button" type="submit">Créer le ticket <span>↗</span></button></form></section>
            <section class="tickets-section"><div class="section-heading"><div><p class="section-label">02 / Mon espace</p><h2>Mes tickets</h2></div><span class="ticket-count"><?= count($myTickets) ?> demande<?= count($myTickets) > 1 ? 's' : '' ?></span></div><?php if (!$myTickets): ?><p class="empty-state">Aucun ticket pour le moment.</p><?php else: ?><div class="ticket-list"><?php foreach ($myTickets as $ticket): ?><article class="ticket-item"><div><span class="ticket-id">#<?= (int) $ticket['id'] ?> · <?= escape($ticket['status']) ?></span><h3><?= escape($ticket['subject']) ?></h3><p><?= nl2br(escape($ticket['message'])) ?></p></div><time><?= escape($ticket['created_at']) ?></time></article><?php endforeach; ?></div><?php endif; ?></section>
            <?php if ($isSupport): ?><section class="support-section"><div class="section-heading"><div><p class="section-label">03 / Modération</p><h2>File support</h2></div><span class="support-badge">Rôle autorisé</span></div><?php if (!$supportCheckReady): ?><p class="notice error">Configurez DISCORD_GUILD_ID, DISCORD_BOT_TOKEN et DISCORD_SUPPORT_ROLE_IDS pour activer la vérification des permissions.</p><?php elseif (!$allTickets): ?><p class="empty-state">La file support est vide.</p><?php else: ?><div class="ticket-list"><?php foreach ($allTickets as $ticket): ?><article class="ticket-item support-ticket"><div><span class="ticket-id">#<?= (int) $ticket['id'] ?> · <?= escape($ticket['status']) ?> · <?= escape($ticket['username']) ?></span><h3><?= escape($ticket['subject']) ?></h3><p><?= nl2br(escape($ticket['message'])) ?></p></div><form method="post"><input type="hidden" name="csrf" value="<?= escape($_SESSION['csrf']) ?>"><input type="hidden" name="action" value="update_ticket"><input type="hidden" name="ticket_id" value="<?= (int) $ticket['id'] ?>"><button type="submit" name="status" value="<?= $ticket['status'] === 'open' ? 'closed' : 'open' ?>"><?= $ticket['status'] === 'open' ? 'Fermer' : 'Rouvrir' ?></button></form></article><?php endforeach; ?></div><?php endif; ?></section><?php endif; ?>
        <?php endif; ?>
    </main>
    <footer class="ticket-footer"><a href="https://discord.com/invite/ad7aMevNMx" target="_blank" rel="noopener noreferrer">Serveur Discord ↗</a><span>Team Royale · Support</span></footer>
</body>
</html>