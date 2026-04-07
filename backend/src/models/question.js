module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Question',
    {
      prompt: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      helpText: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      type: {
        type: DataTypes.ENUM('multiple_choice', 'text'),
        allowNull: false,
        defaultValue: 'multiple_choice',
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      options: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      correctAnswer: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      mediaType: {
        type: DataTypes.ENUM('none', 'image', 'audio', 'video'),
        allowNull: false,
        defaultValue: 'none',
      },
      mediaUrl: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '',
      },
      timeLimitSeconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 20,
      },
      points: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },
      penaltyPoints: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },
    },
    {
      tableName: 'questions',
    },
  );
