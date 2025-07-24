import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  LoginRequest,
  SignupRequest,
  AuthResponse,
  AuthRequest,
  User,
  hashPassword,
  comparePassword,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  validateSignup,
  validateEmail,
  authenticateToken
} from './auth.ts';

export function createAuthRoutes(databaseAdapter: any): Router {
  const router = Router();

  // POST /auth/signup
  router.post('/signup', async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, email, password }: SignupRequest = req.body;

      // Validate input
      const validation = validateSignup({ name, email, password });
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: validation.errors.join(', ')
        });
        return;
      }

      // Check if user already exists
      const existingUser = await databaseAdapter.getAccountById(email);
      if (existingUser) {
        res.status(409).json({
          success: false,
          error: 'User with this email already exists'
        });
        return;
      }

      // Hash password
      const hashedPassword = await hashPassword(password);

      // Create user account
      const userId = uuidv4();
      const now = new Date().toISOString();
      const pointsNextRegen = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const newUser = {
        id: userId,
        name: name.trim(),
        email: email.toLowerCase(),
        password: hashedPassword,
        is_agent: false,
        points: 100, // Starting points
        user_type: 'user',
        subscription_tier: 'free',
        is_active: true,
        email_verified: false,
        total_sessions: 0,
        points_last_regen: now,
        points_next_regen: pointsNextRegen,
        timezone: 'UTC',
        preferences: '{}',
        created_at: now,
        updated_at: now
      };

      // Save to database using the adapter's method
      await databaseAdapter.createAccount(newUser);

      // Generate tokens
      const token = generateToken(userId, email);
      const refreshToken = generateRefreshToken(userId, email);

      // Remove password from response
      const userResponse: User = {
        id: userId,
        name: newUser.name,
        email: newUser.email,
        points: newUser.points,
        user_type: newUser.user_type as 'user' | 'creator' | 'admin',
        subscription_tier: newUser.subscription_tier as 'free' | 'premium' | 'enterprise',
        is_active: newUser.is_active,
        email_verified: newUser.email_verified,
        total_sessions: newUser.total_sessions,
        points_next_regen: newUser.points_next_regen,
        created_at: newUser.created_at,
        updated_at: newUser.updated_at
      };

      const response: AuthResponse = {
        success: true,
        user: userResponse,
        token,
        refreshToken
      };

      res.status(201).json(response);
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during signup'
      });
    }
  });

  // POST /auth/login
  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password }: LoginRequest = req.body;

      // Validate input
      if (!email || !validateEmail(email)) {
        res.status(400).json({
          success: false,
          error: 'Please provide a valid email address'
        });
        return;
      }

      if (!password) {
        res.status(400).json({
          success: false,
          error: 'Password is required'
        });
        return;
      }

      // Find user by email
      const user = await databaseAdapter.getAccountById(email.toLowerCase());
      if (!user) {
        res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
        return;
      }

      // Check if account is active
      if (!user.is_active) {
        res.status(401).json({
          success: false,
          error: 'Account is deactivated'
        });
        return;
      }

      // Verify password
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
        return;
      }

      // Update last login
      await databaseAdapter.updateAccount(user.id, {
        last_login: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // Generate tokens
      const token = generateToken(user.id, user.email);
      const refreshToken = generateRefreshToken(user.id, user.email);

      // Prepare user response (exclude password)
      const userResponse: User = {
        id: user.id,
        name: user.name,
        email: user.email,
        points: user.points || 100,
        user_type: user.user_type || 'user',
        subscription_tier: user.subscription_tier || 'free',
        is_active: user.is_active,
        email_verified: user.email_verified || false,
        total_sessions: user.total_sessions || 0,
        points_next_regen: user.points_next_regen || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_at: user.created_at,
        updated_at: new Date().toISOString()
      };

      const response: AuthResponse = {
        success: true,
        user: userResponse,
        token,
        refreshToken
      };

      res.json(response);
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during login'
      });
    }
  });

  // POST /auth/refresh
  router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          error: 'Refresh token is required'
        });
        return;
      }

      const decoded = verifyRefreshToken(refreshToken);
      if (!decoded) {
        res.status(403).json({
          success: false,
          error: 'Invalid or expired refresh token'
        });
        return;
      }

      // Get user from database
      const user = await databaseAdapter.getAccountById(decoded.userId);
      if (!user || !user.is_active) {
        res.status(403).json({
          success: false,
          error: 'User not found or inactive'
        });
        return;
      }

      // Generate new tokens
      const newToken = generateToken(user.id, user.email);
      const newRefreshToken = generateRefreshToken(user.id, user.email);

      // Prepare user response
      const userResponse: User = {
        id: user.id,
        name: user.name,
        email: user.email,
        points: user.points || 100,
        user_type: user.user_type || 'user',
        subscription_tier: user.subscription_tier || 'free',
        is_active: user.is_active,
        email_verified: user.email_verified || false,
        total_sessions: user.total_sessions || 0,
        points_next_regen: user.points_next_regen || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_at: user.created_at,
        updated_at: user.updated_at
      };

      res.json({
        success: true,
        user: userResponse,
        token: newToken,
        refreshToken: newRefreshToken
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during token refresh'
      });
    }
  });

  // GET /auth/me - Get current user info
  router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await databaseAdapter.getAccountById(req.user!.id);
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
        return;
      }

      const userResponse: User = {
        id: user.id,
        name: user.name,
        email: user.email,
        points: user.points || 100,
        user_type: user.user_type || 'user',
        subscription_tier: user.subscription_tier || 'free',
        is_active: user.is_active,
        email_verified: user.email_verified || false,
        total_sessions: user.total_sessions || 0,
        points_next_regen: user.points_next_regen || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_at: user.created_at,
        updated_at: user.updated_at
      };

      res.json({
        success: true,
        user: userResponse
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // POST /users/spend-points - Spend points
  router.post('/users/spend-points', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { amount } = req.body;
      const userId = req.user!.id;

      if (!amount || amount <= 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid amount'
        });
        return;
      }

      const user = await databaseAdapter.getAccountById(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
        return;
      }

      if (user.points < amount) {
        res.status(400).json({
          success: false,
          error: 'Insufficient points'
        });
        return;
      }

      // Update user points
      const newBalance = user.points - amount;
      await databaseAdapter.updateAccount(userId, {
        points: newBalance,
        updated_at: new Date().toISOString()
      });

      // Create points transaction record
      await databaseAdapter.createPointsTransaction({
        id: uuidv4(),
        user_id: userId,
        transaction_type: 'debit',
        points_amount: amount,
        reason: 'private_session',
        description: `Spent ${amount} points for private session`,
        balance_before: user.points,
        balance_after: newBalance,
        created_at: new Date().toISOString()
      });

      res.json({
        success: true,
        newBalance
      });
    } catch (error) {
      console.error('Spend points error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  return router;
}