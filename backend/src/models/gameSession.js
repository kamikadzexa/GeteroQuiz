module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'GameSession',
    {
      joinCode: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM('lobby', 'live', 'finished'),
        allowNull: false,
        defaultValue: 'lobby',
      },
      phase: {
        type: DataTypes.ENUM('waiting', 'open', 'review', 'finished'),
        allowNull: false,
        defaultValue: 'waiting',
      },
      currentQuestionIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: -1,
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'game_sessions',
    },
  );
